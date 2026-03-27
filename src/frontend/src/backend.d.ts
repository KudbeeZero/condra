import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface TransformationInput {
    context: Uint8Array;
    response: http_request_result;
}
export interface HighScore {
    score: bigint;
    playerName: string;
}
export interface TransformationOutput {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export interface PlayerProgress {
    currentStage: bigint;
    upgradeChoices: string;
    totalKills: bigint;
}
export interface http_header {
    value: string;
    name: string;
}
export interface http_request_result {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export interface backendInterface {
    getLeaderboard(): Promise<Array<HighScore>>;
    getNarration(text: string): Promise<string>;
    getProgress(sessionId: string): Promise<PlayerProgress | null>;
    saveProgress(sessionId: string, progress: PlayerProgress): Promise<void>;
    submitScore(playerName: string, score: bigint): Promise<void>;
    transform(input: TransformationInput): Promise<TransformationOutput>;
}
