// options.js
document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('list');
    const addBtn = document.getElementById('addBtn');
    const saveBtn = document.getElementById('saveBtn');

    // Load existing dictionary
    chrome.storage.local.get({ dictionary: [] }, (result) => {
        const dict = result.dictionary || [];
        if (dict.length === 0) {
            addEntry("", "");
        } else {
            dict.forEach(entry => addEntry(entry.from, entry.to));
        }
    });

    addBtn.addEventListener('click', () => {
        addEntry("", "");
    });

    saveBtn.addEventListener('click', () => {
        const entries = [];
        document.querySelectorAll('.entry').forEach(div => {
            const inputs = div.querySelectorAll('input');
            const from = inputs[0].value.trim();
            const to = inputs[1].value.trim();
            if (from) {
                entries.push({ from, to });
            }
        });

        chrome.storage.local.set({ dictionary: entries }, () => {
            const status = document.getElementById('status');
            status.style.opacity = 1;
            setTimeout(() => { status.style.opacity = 0; }, 2000);
        });
    });

    function addEntry(fromVal, toVal) {
        const div = document.createElement('div');
        div.className = 'entry';

        const fromInput = document.createElement('input');
        fromInput.type = 'text';
        fromInput.placeholder = '置換元の単語 (k4sen)';
        fromInput.value = fromVal;

        const arrow = document.createElement('span');
        arrow.textContent = '→';

        const toInput = document.createElement('input');
        toInput.type = 'text';
        toInput.placeholder = '読み方 (かせん)';
        toInput.value = toVal;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove';
        removeBtn.textContent = '削除';
        removeBtn.addEventListener('click', () => {
            div.remove();
        });

        div.append(fromInput, arrow, toInput, removeBtn);

        listEl.appendChild(div);
    }
});
