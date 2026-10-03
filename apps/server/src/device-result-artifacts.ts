import path from "node:path";
import { writeFileSync } from "node:fs";
import type { DeviceCommandRecord } from "@tyr-ai/contracts";
import type { ServerRouteContext } from "./server-context";

type ArtifactStore = Pick<ServerRouteContext["store"], "createAttachment">;

export function materializeDeviceCommandResultArtifacts(input: {
  store: ArtifactStore;
  command: DeviceCommandRecord;
  uploadDir: string;
  artifactIds: string[];
  rawData?: Record<string, unknown>;
}): { artifactIds: string[]; data?: Record<string, unknown> } {
  const artifactIds = [...input.artifactIds];
  let resultData = input.rawData;
  if (input.command.capability !== "screen.capture_app_snapshot" || !input.command.channelId || typeof input.rawData?.imageBase64 !== "string") {
    return { artifactIds, data: resultData };
  }

  const imageBase64 = input.rawData.imageBase64.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(imageBase64, "base64");
  if (imageBuffer.length <= 0) return { artifactIds, data: resultData };

  const filename = `device-snapshot-${input.command.id}.png`;
  const storedPath = path.join(input.uploadDir, filename);
  writeFileSync(storedPath, imageBuffer);
  const attachment = input.store.createAttachment({
    channelId: input.command.channelId,
    filename,
    mimeType: "image/png",
    sizeBytes: imageBuffer.length,
    path: storedPath
  });
  artifactIds.push(attachment.id);
  // Device command rows keep metadata only; image bytes are stored as normal chat attachments.
  resultData = Object.fromEntries(Object.entries(input.rawData).filter(([key]) => key !== "imageBase64"));
  return { artifactIds, data: resultData };
}
