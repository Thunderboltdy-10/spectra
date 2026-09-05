async (page) => {
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      saved: /\bSaved\b/.test(text),
      reconnect: /Reconnect/i.test(text),
      queued: /Queued|queued safely/i.test(text),
      connectDevice: /Connect this device/i.test(text),
      noLonger: /no longer connected/i.test(text),
      syncing: /Syncing/i.test(text),
      statuses: [...document.querySelectorAll("[role=status]")]
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 10),
    };
  });
}
