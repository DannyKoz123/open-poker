export type NodeId = string;

export interface RoomDirectory {
  ownerFor(roomId: string): Promise<NodeId>;
  claimRoom(roomId: string): Promise<NodeId>;
  releaseRoom(roomId: string): Promise<void>;
}

export class LocalRoomDirectory implements RoomDirectory {
  constructor(private readonly nodeId: NodeId = 'local') {}

  async ownerFor(_roomId: string): Promise<NodeId> {
    return this.nodeId;
  }

  async claimRoom(_roomId: string): Promise<NodeId> {
    return this.nodeId;
  }

  async releaseRoom(_roomId: string): Promise<void> {}
}
