export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isRecentMessage(timeStr) {
    // If no time string, assume safe/recent
    if (!timeStr) return true;

    const matches = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!matches) return true;

    let h = parseInt(matches[1], 10);
    let m = parseInt(matches[2], 10);
    const now = new Date();

    // AM/PM logic
    const lowerStr = timeStr.toLowerCase();
    if (lowerStr.includes('pm') && h < 12) h += 12;
    if (lowerStr.includes('am') && h === 12) h = 0;

    const nowH = now.getHours();
    const nowM = now.getMinutes();

    let msgMinutes = h * 60 + m;
    let nowMinutes = nowH * 60 + nowM;

    let diff = nowMinutes - msgMinutes;

    // Date crossover correction
    if (diff < -1000) diff += 1440;
    if (diff > 1000) diff -= 1440;

    // Allow up to 10 minutes to absorb Twitch dashboard redraw and delay.
    return diff >= -10 && diff <= 10;
}
