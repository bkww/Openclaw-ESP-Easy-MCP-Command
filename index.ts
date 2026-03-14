import mqtt from "mqtt";
import { Type } from "@sinclair/typebox";

type DeviceCfg = {
  id: string;
  name?: string;
  sysname?: string;
  cmdTopic?: string;
  defaultPin?: number;
  invert?: boolean;
};

type PluginCfg = {
  brokerUrl: string;
  username?: string;
  password?: string;
  clientId?: string;
  devices: DeviceCfg[];
};

let client: mqtt.MqttClient | null = null;
let isConnected = false;

function toolText(text: string) {
  return { content: [{ type: "text", text }] };
}

function getCfg(api: any): PluginCfg {
  // 兼容读取：api.pluginConfig 或 config.plugins.entries.<id>.config
  const pluginId = "esp-easy-cmd";
  const c1 = (api as any).pluginConfig;
  const c2 = (api as any).config?.plugins?.entries?.[pluginId]?.config;
  return (c1 ?? c2 ?? {}) as PluginCfg;
}

function normalizeDevice(d: DeviceCfg): Required<Pick<DeviceCfg, "id" | "invert">> & DeviceCfg & { cmdTopic: string } {
  const sysname = d.sysname ?? d.id;
  const cmdTopic = d.cmdTopic ?? `${sysname}/cmd`;
  return { ...d, invert: !!d.invert, cmdTopic, sysname };
}

function ensureMqtt(api: any, cfg: PluginCfg) {
  if (client) return;

  client = mqtt.connect(cfg.brokerUrl, {
    clientId: cfg.clientId ?? "openclaw-esp-easy-cmd",
    username: cfg.username,
    password: cfg.password
  });

  client.on("connect", () => {
    isConnected = true;
  });

  client.on("close", () => {
    isConnected = false;
  });

  client.on("error", () => {
    // 由 OpenClaw 日志系统接管更好，但这里保持最小实现
    isConnected = false;
  });
}

async function publishCommand(topic: string, command: string) {
  if (!client) throw new Error("MQTT client not initialized");
  await new Promise<void>((resolve, reject) => {
    client!.publish(topic, command, { qos: 0, retain: false }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * ESP Easy 文档：MQTT 命令是发布到 <subscribeTemplate>/cmd，payload 为 <command> [1](https://espeasy.readthedocs.io/en/latest/Reference/Command.html)
 * 例如：topic=ESP_Easy/cmd payload="gpio,12,1" [5](https://www.letscontrolit.com/forum/viewtopic.php?t=9303)
 */
export default function (api: any) {
  // 1) list
  api.registerTool(
    {
      name: "esp_easy_list",
      description: "List ESP Easy nodes configured for MQTT /cmd control.",
      parameters: Type.Object({}),
      async execute() {
        const cfg = getCfg(api);
        ensureMqtt(api, cfg);
        const devices = (cfg.devices ?? []).map(normalizeDevice).map(d => ({
          id: d.id,
          name: d.name ?? d.id,
          cmdTopic: d.cmdTopic,
          defaultPin: d.defaultPin ?? null,
          invert: d.invert
        }));
        return {
          content: [{ type: "text", text: JSON.stringify({ connected: isConnected, devices }, null, 2) }]
        };
      }
    },
    { optional: true }
  );

  // 2) raw command
  api.registerTool(
    {
      name: "esp_easy_cmd",
      description: "Send a raw ESPEasy command string to <sysname>/cmd via MQTT (no Rules needed).",
      parameters: Type.Object({
        deviceId: Type.String(),
        command: Type.String()
      }),
      async execute(_id: string, params: { deviceId: string; command: string }) {
        const cfg = getCfg(api);
        ensureMqtt(api, cfg);

        const dev = (cfg.devices ?? []).map(normalizeDevice).find(d => d.id === params.deviceId);
        if (!dev) return toolText(`Unknown deviceId: ${params.deviceId}`);

        await publishCommand(dev.cmdTopic, params.command);
        return toolText(`OK: published command to ${dev.cmdTopic}: ${params.command} (connected=${isConnected})`);
      }
    },
    { optional: true }
  );

  // 3) gpio write helper
  api.registerTool(
    {
      name: "esp_easy_gpio",
      description: "Write GPIO pin using ESPEasy command GPIO,<pin>,<0|1> over MQTT /cmd.",
      parameters: Type.Object({
        deviceId: Type.String(),
        pin: Type.Integer(),
        value: Type.Union([Type.Integer({ minimum: 0, maximum: 1 }), Type.Boolean()])
      }),
      async execute(_id: string, params: { deviceId: string; pin: number; value: number | boolean }) {
        const cfg = getCfg(api);
        ensureMqtt(api, cfg);

        const dev = (cfg.devices ?? []).map(normalizeDevice).find(d => d.id === params.deviceId);
        if (!dev) return toolText(`Unknown deviceId: ${params.deviceId}`);

        let v = typeof params.value === "boolean" ? (params.value ? 1 : 0) : params.value;
        if (dev.invert) v = v ? 0 : 1;

        const cmd = `gpio,${params.pin},${v}`;
        await publishCommand(dev.cmdTopic, cmd);
        return toolText(`OK: ${cmd} -> ${dev.cmdTopic} (invert=${dev.invert}, connected=${isConnected})`);
      }
    },
    { optional: true }
  );

  // 4) switch on/off using defaultPin
  api.registerTool(
    {
      name: "esp_easy_switch",
      description: "Turn device ON/OFF by sending gpio,<defaultPin>,<0|1> to /cmd. Requires device.defaultPin.",
      parameters: Type.Object({
        deviceId: Type.String(),
        on: Type.Boolean()
      }),
      async execute(_id: string, params: { deviceId: string; on: boolean }) {
        const cfg = getCfg(api);
        ensureMqtt(api, cfg);

        const dev = (cfg.devices ?? []).map(normalizeDevice).find(d => d.id === params.deviceId);
        if (!dev) return toolText(`Unknown deviceId: ${params.deviceId}`);
        if (dev.defaultPin == null) return toolText(`Device ${params.deviceId} missing defaultPin`);

        let v = params.on ? 1 : 0;
        if (dev.invert) v = v ? 0 : 1;

        const cmd = `gpio,${dev.defaultPin},${v}`;
        await publishCommand(dev.cmdTopic, cmd);
        return toolText(`OK: ${params.on ? "ON" : "OFF"} => ${cmd} -> ${dev.cmdTopic} (connected=${isConnected})`);
      }
    },
    { optional: true }
  );
}
