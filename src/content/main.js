import { CONFIG_DEFAULTS } from './constants.js';
import { LockManager } from './lock-manager.js';
import { MessageProcessor } from './message-processor.js';
import { DomObserver } from './dom-observer.js';

const config = { ...CONFIG_DEFAULTS };

// Initialize components
const lockManager = new LockManager();
const messageProcessor = new MessageProcessor(config, lockManager);
const domObserver = new DomObserver(config, lockManager, messageProcessor);

function init() {
    // Load config
    chrome.storage.local.get(config, (items) => {
        if (items) Object.assign(config, items);
    });

    chrome.storage.onChanged.addListener((changes) => {
        for (let key in changes) {
            if (config[key] !== undefined) {
                config[key] = changes[key].newValue;
            }
        }
    });

    // Start logic
    lockManager.init();
    domObserver.start();
}

// Start
init();
