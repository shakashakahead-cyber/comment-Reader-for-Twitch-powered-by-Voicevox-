export class DomObserver {
    constructor(config, lockManager, messageProcessor) {
        this.config = config;
        this.lockManager = lockManager;
        this.messageProcessor = messageProcessor;
        this.observer = null;
        this.scriptStartTime = Date.now();
    }

    start() {
        this.observer = new MutationObserver((mutations) => {
            if (!this.config.enabled) return;
            if (!this.lockManager.isPrimary()) return;

            // Startup buffer
            if (Date.now() - this.scriptStartTime < (this.config.skipTime * 1000)) return;

            let addedMessageCount = 0;
            let candidates = [];

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;

                    const nodeText = String(node.innerText || "");
                    if (node.classList.contains('chat-list__new-messages-indicator') ||
                        nodeText.includes("新着メッセージ")) return;

                    const containerSelectors = [
                        '.chat-line__message',
                        'div[data-test-selector="chat-line-message"]',
                        '.chat-line__message-container'
                    ];

                    let found = [];
                    if (containerSelectors.some(sel => node.matches && node.matches(sel))) found.push(node);
                    for (const sel of containerSelectors) node.querySelectorAll(sel).forEach(el => found.push(el));

                    found.forEach(el => {
                        if (!candidates.includes(el)) {
                            candidates.push(el);
                            addedMessageCount++;
                        }
                    });
                });
            });

            // Mass redraw protection
            if (addedMessageCount >= 50) {
                console.log(`Mass redraw detected (${addedMessageCount} items). Skipping.`);
                candidates.forEach(c => c.dataset.voxRead = "true");
                return;
            }

            candidates.forEach(container => {
                this.messageProcessor.scheduleMessageProcessing(container);
            });
        });

        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    stop() {
        if (this.observer) this.observer.disconnect();
    }
}
