import { MASS_REDRAW_PROCESS_LIMIT, MASS_REDRAW_THRESHOLD } from './constants.js';

export class DomObserver {
    constructor(config, lockManager, messageProcessor) {
        this.config = config;
        this.lockManager = lockManager;
        this.messageProcessor = messageProcessor;
        this.observer = null;
        this.scriptStartTime = Date.now();
        this.containerSelectorQuery = [
            '.chat-line__message',
            'div[data-test-selector="chat-line-message"]',
            '.chat-line__message-container'
        ].join(', ');
    }

    start() {
        this.observer = new MutationObserver((mutations) => {
            if (!this.config.enabled) return;
            if (!this.lockManager.isPrimary()) return;

            // Startup buffer
            if (Date.now() - this.scriptStartTime < (this.config.skipTime * 1000)) return;

            const candidates = new Set();

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => this.collectCandidates(node, candidates));
                this.collectCandidates(mutation.target, candidates);
            });

            const candidateList = Array.from(candidates);

            // Mass redraw protection: keep newest subset instead of skipping all.
            if (candidateList.length >= MASS_REDRAW_THRESHOLD) {
                const reduced = candidateList.slice(-MASS_REDRAW_PROCESS_LIMIT);
                console.log(
                    `Mass redraw detected (${candidateList.length} items). Processing latest ${reduced.length}.`
                );
                reduced.forEach((container) => this.messageProcessor.scheduleMessageProcessing(container));
                return;
            }

            candidateList.forEach((container) => {
                this.messageProcessor.scheduleMessageProcessing(container);
            });
        });

        this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    stop() {
        if (this.observer) this.observer.disconnect();
    }

    collectCandidates(node, candidates) {
        if (!node) return;

        const element = node.nodeType === Node.ELEMENT_NODE
            ? node
            : (node.parentElement || null);

        if (!element) return;

        if (element.classList.contains('chat-list__new-messages-indicator')) {
            return;
        }

        if (element.matches && element.matches(this.containerSelectorQuery)) {
            candidates.add(element);
        }

        if (element.closest) {
            const parentContainer = element.closest(this.containerSelectorQuery);
            if (parentContainer) candidates.add(parentContainer);
        }

        if (element.querySelectorAll) {
            element.querySelectorAll(this.containerSelectorQuery).forEach((container) => candidates.add(container));
        }
    }
}
