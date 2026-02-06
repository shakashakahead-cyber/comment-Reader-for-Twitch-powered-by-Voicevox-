export const HISTORY_TTL_MS = 3 * 60 * 1000;
export const STABLE_CHECK_DELAY_MS = 100;
export const STABLE_CHECK_MAX_TRIES = 12;
export const SIGNATURE_DEDUP_WINDOW_MS = 3 * 1000;
export const MASS_REDRAW_THRESHOLD = 50;
export const MASS_REDRAW_PROCESS_LIMIT = 20;
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
