import {
  getHeartbeat,
  HeartbeatRecord,
  HeartbeatStatus,
  HeartbeatWriteInput,
  listHeartbeats,
  listStaleHeartbeats,
  recordHeartbeat,
} from "./db";

export type { HeartbeatRecord, HeartbeatStatus, HeartbeatWriteInput };

export function writeHeartbeat(input: HeartbeatWriteInput): HeartbeatRecord {
  return recordHeartbeat(input);
}

export function readHeartbeat(worker: string): HeartbeatRecord | null {
  return getHeartbeat(worker);
}

export function readHeartbeats(): HeartbeatRecord[] {
  return listHeartbeats();
}

export function readStaleHeartbeats(thresholdMs: number, now = new Date()): HeartbeatRecord[] {
  return listStaleHeartbeats(thresholdMs, now);
}
