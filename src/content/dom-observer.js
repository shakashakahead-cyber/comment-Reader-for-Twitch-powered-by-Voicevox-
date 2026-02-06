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
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => this.collectCandidatesFromAddedNode(node, candidates));
                    return;
                }

                if (mutation.type === 'characterData') {
                    this.collectCandidateFromChangedNode(mutation.target, candidates);
                }
            });

            const candidateList = Array.from(candidates).filter((container) => !container.dataset.voxRead);

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

        // Ignore messages that already exist when script starts.
        this.markCurrentMessagesAsRead();
    }

    stop() {
        if (this.observer) this.observer.disconnect();
    }

    markCurrentMessagesAsRead() {
        const now = Date.now();
        document.querySelectorAll(this.containerSelectorQuery).forEach((container) => {
            if (typeof this.messageProcessor.rememberExistingContainer === "function") {
                this.messageProcessor.rememberExistingContainer(container, now);
                return;
            }
            container.dataset.voxRead = "true";
        });
    }

    collectCandidatesFromAddedNode(node, candidates) {
        if (!node) return;

        if (node.nodeType !== Node.ELEMENT_NODE) {
            this.collectCandidateFromChangedNode(node, candidates);
            return;
        }

        const element = node;

        if (element.classList?.contains('chat-list__new-messages-indicator')) {
            return;
        }

        if (element.matches?.(this.containerSelectorQuery)) {
            candidates.add(element);
        }

        element.querySelectorAll?.(this.containerSelectorQuery).forEach((container) => candidates.add(container));

        const parentContainer = element.closest?.(this.containerSelectorQuery);
        if (parentContainer) candidates.add(parentContainer);
    }

    collectCandidateFromChangedNode(node, candidates) {
        if (!node) return;

        const element = node.nodeType === Node.ELEMENT_NODE
            ? node
            : node.parentElement;

        if (!element) return;

        const container = element.closest?.(this.containerSelectorQuery);
        if (container) candidates.add(container);
    }
}
