export type PhhVariant = 'nlhe';

export interface PhhExport {
  handId: string;
  variant: PhhVariant;
  content: string;
}

export interface PhhSerializer<Input> {
  serialize(input: Input): PhhExport;
}
