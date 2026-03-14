import { publishMqtt } from "./mqtt.js";

type Device = {
  id: string;
  name: string;
  sysname: string;
  cmdTopic: string;
  defaultPin: number;
  invert: boolean;
};

type PluginConfig = {
  brokerUrl: string;
  clientId: string;
  devices: Device[];
};

function findDevice(cfg: PluginConfig, key: string) {
  return cfg.devices.find(d => d.id === key || d.name === key);
}

function gpioPayload(pin: number, value01: 0 | 1, invert: boolean) {
  const v = invert ? (value01 === 1 ? 0 : 1) : value01;
  return `gpio,${pin},${v}`;
}

export default function (api: any) {
  // 从 openclaw.json 读取：plugins.entries.esp-easy-cmd.config
  const cfg: PluginConfig | undefined =
    api?.config?.plugins?.entries?.["esp-easy-cmd"]?.config;

  // 防御：避免 cfg 为空导致后续 NPE
  if (!cfg) {
    // 这里不能 throw（会阻断整个网关启动），注册一个工具但提示配置缺失
    api.registerTool({
      name: "esp_easy_switch",
      description: "ESP Easy switch tool (CONFIG MISSING).",
      parameters: {
        type: "object",
        properties: { device: { type: "string" }, state: { type: "string" } },
        required: ["device", "state"]
      },
      async execute(_toolCallId: string) {
        return {
          content: [{ type: "text", text: "esp-easy-cmd config missing at plugins.entries.esp-easy-cmd.config" }]
        };
      }
    });
    return;
  }

  // ✅ 用文档推荐的 api.registerTool 注册工具（不是 api.tools.register）[1](https://open-claw.bot/docs/tools/plugins/agent-tools/)[3](https://ipgp.sharepoint.com/sites/IPGCHINA/Shared%20Documents/Marketing/00%20Marketing%e5%af%b9%e5%a4%96%e5%ae%a3%e4%bc%a0%e8%b5%84%e6%96%99/%e5%ae%a3%e4%bc%a0%e6%89%8b%e5%86%8c/Datasheet/%e5%b7%a5%e4%b8%9a%e7%ba%a7%e8%bf%9e%e7%bb%ad%e5%85%89%e7%ba%a4%e6%bf%80%e5%85%89%e5%99%a8/YLS-AMB%e7%b3%bb%e5%88%97%e5%85%89%e6%9d%9f%e6%a8%a1%e5%bc%8f%e5%8f%af%e8%b0%83%e6%bf%80%e5%85%89%e5%99%a8.pdf?web=1)
  api.registerTool({
    name: "esp_easy_switch",
    description: "Switch ESP Easy device defaultPin ON/OFF via cmdTopic.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        device: { type: "string", description: "Device id or name (e.g., xiaoai / 小爱开关)" },
        state: { type: "string", enum: ["on", "off"] }
      },
      required: ["device", "state"]
    },
    async execute(_toolCallId: string, params: { device: string; state: "on" | "off" }) {
      const d = findDevice(cfg, params.device);
      if (!d) {
        return {
          content: [{ type: "text", text: `Unknown device "${params.device}". Check config devices[].id/name.` }]
        };
      }

      const value: 0 | 1 = params.state === "on" ? 1 : 0;
      const payload = gpioPayload(d.defaultPin, value, d.invert);

      const result = await publishMqtt(cfg.brokerUrl, cfg.clientId, d.cmdTopic, payload);

      return {
        content: [
          { type: "text", text: `OK: ${d.name} -> ${result.topic} ${result.payload}` }
        ],
        details: { deviceId: d.id, topic: result.topic, payload: result.payload }
      };
    }
  });

  api.registerTool({
    name: "esp_easy_gpio",
    description: "Publish gpio,<pin>,<0|1> to a device cmdTopic.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        device: { type: "string", description: "Device id or name" },
        pin: { type: "integer", minimum: 0, maximum: 40 },
        value: { type: "integer", enum: [0, 1] }
      },
      required: ["device", "pin", "value"]
    },
    async execute(_toolCallId: string, params: { device: string; pin: number; value: 0 | 1 }) {
      const d = findDevice(cfg, params.device);
      if (!d) {
        return {
          content: [{ type: "text", text: `Unknown device "${params.device}". Check config devices[].id/name.` }]
        };
      }

      const payload = gpioPayload(params.pin, params.value, d.invert);
      const result = await publishMqtt(cfg.brokerUrl, cfg.clientId, d.cmdTopic, payload);

      return {
        content: [
          { type: "text", text: `OK: ${d.name} -> ${result.topic} ${result.payload}` }
        ],
        details: { deviceId: d.id, topic: result.topic, payload: result.payload }
      };
    }
  });
}
