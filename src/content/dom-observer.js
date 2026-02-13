import { MASS_REDRAW_THRESHOLD } from './constants.js';

export class DomObserver {
    constructor(config, lockManager, messageProcessor) {
        this.config = config;
        this.lockManager = lockManager;
        this.messageProcessor = messageProcessor;
        this.observer = null;
        this.scriptStartTime = Date.now();
        this.lastLocationHref = window.location.href;
        this.rebaselineTimerId = null;
        this.visibilityChangeHandler = null;
        this.pageShowHandler = null;
        this.containerSelectorQuery = [
            '.chat-line__message',
            'div[data-test-selector="chat-line-message"]',
            '.chat-line__message-container'
        ].join(', ');
    }

    start() {
        this.lastLocationHref = window.location.href;

        this.visibilityChangeHandler = () => {
            if (document.visibilityState === 'visible') {
                this.rebaselineCurrentMessages('visibility-change');
            }
        };
        this.pageShowHandler = () => {
            this.rebaselineCurrentMessages('pageshow');
        };

        document.addEventListener('visibilitychange', this.visibilityChangeHandler, true);
        window.addEventListener('pageshow', this.pageShowHandler, true);

        this.observer = new MutationObserver((mutations) => {
            if (!this.config.enabled) return;
            if (!this.lockManager.isPrimary()) return;

            if (window.location.href !== this.lastLocationHref) {
                this.lastLocationHref = window.location.href;
                this.rebaselineCurrentMessages('location-change');
                return;
            }

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

            // Mass redraw usually means view remount/navigation. Treat as existing backlog.
            if (candidateList.length >= MASS_REDRAW_THRESHOLD) {
                console.log(
                    `Mass redraw detected (${candidateList.length} items). Rebaselining existing messages.`
                );
                this.rebaselineCurrentMessages('mass-redraw');
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
        if (this.rebaselineTimerId) {
            clearTimeout(this.rebaselineTimerId);
            this.rebaselineTimerId = null;
        }
        if (this.visibilityChangeHandler) {
            document.removeEventListener('visibilitychange', this.visibilityChangeHandler, true);
            this.visibilityChangeHandler = null;
        }
        if (this.pageShowHandler) {
            window.removeEventListener('pageshow', this.pageShowHandler, true);
            this.pageShowHandler = null;
        }
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

    rebaselineCurrentMessages(reason = 'unknown') {
        this.scriptStartTime = Date.now();
        this.markCurrentMessagesAsRead();

        if (this.rebaselineTimerId) {
            clearTimeout(this.rebaselineTimerId);
        }

        const delay = Math.max(300, this.config.skipTime * 1000);
        this.rebaselineTimerId = setTimeout(() => {
            this.markCurrentMessagesAsRead();
            this.rebaselineTimerId = null;
        }, delay);

        console.log(`[TwitchReader] Rebased current messages (${reason}).`);
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
