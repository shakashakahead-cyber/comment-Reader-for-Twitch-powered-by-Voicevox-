export const HISTORY_TTL_MS = 3 * 60 * 1000;
export const STABLE_CHECK_DELAY_MS = 80;
export const STABLE_CHECK_MAX_TRIES = 6;
export const ACTIVE_READER_KEY = "voxActiveReader";
export const ACTIVE_READER_TTL_MS = 8000;
export const ACTIVE_READER_HEARTBEAT_MS = 2000;

export const CONFIG_DEFAULTS = {
    enabled: true, speakerId: 3, speed: 1.0, volume: 1.0,
    maxLength: 70, readName: false, ignoreCommand: true,
    skipTime: 3,
    blockList: "", audioDeviceId: "",
    dictionary: []
};
