import mqtt from "mqtt";

let client: mqtt.MqttClient | null = null;
let connecting: Promise<mqtt.MqttClient> | null = null;

export function getMqttClient(brokerUrl: string, clientId: string) {
  if (client) return Promise.resolve(client);
  if (connecting) return connecting;

  connecting = new Promise<mqtt.MqttClient>((resolve, reject) => {
    const c = mqtt.connect(brokerUrl, { clientId });

    const onError = (err: any) => {
      cleanup();
      connecting = null;
      reject(err);
    };

    const onConnect = () => {
      cleanup();
      client = c;
      connecting = null;
      resolve(c);
    };

    const cleanup = () => {
      c.off("error", onError);
      c.off("connect", onConnect);
    };

    c.on("error", onError);
    c.on("connect", onConnect);
  });

  return connecting;
}

export async function publishMqtt(
  brokerUrl: string,
  clientId: string,
  topic: string,
  payload: string
) {
  const c = await getMqttClient(brokerUrl, clientId);

  await new Promise<void>((resolve, reject) => {
    c.publish(topic, payload, {}, (err) => (err ? reject(err) : resolve()));
  });

  return { topic, payload };
}
