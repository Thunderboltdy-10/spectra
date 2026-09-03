async (page) => {
  return await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0.02 &&
        rect.width > 1 &&
        rect.height > 1
      );
    };
    const candidates = [
      ...document.querySelectorAll(
        "h1,h2,h3,h4,p,label,button,a,[role=alert],[role=status],[role=dialog] [data-slot=description],li,td,th",
      ),
    ]
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        text: (element.innerText || element.textContent || "")
          .trim()
          .replace(/\s+/g, " "),
      }))
      .filter((item) => item.text && item.text.length <= 1200);
    const unique = [
      ...new Map(
        candidates.map((item) => [`${item.tag}|${item.text}`, item]),
      ).values(),
    ];
    const rules = [
      ["machine-token", /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/],
      [
        "implementation-language",
        /\b(?:replica|projection|materiali[sz]e|recordId|providerId|capability manifest|idempotency|payload ref|tenant|enum|mutation|query|websocket|convex|hocuspocus)\b/i,
      ],
      [
        "raw-request-language",
        /\b(?:request id|status code|internal server|stack trace|unexpected server error|failed to fetch)\b/i,
      ],
      [
        "robotic-certainty",
        /\b(?:successfully completed|operation was successful|please be advised|in order to|the following action|an error has occurred)\b/i,
      ],
    ];
    const flags = [];
    for (const item of unique) {
      for (const [rule, pattern] of rules) {
        if (pattern.test(item.text)) flags.push({ rule, ...item });
      }
      if (item.tag === "p" && item.text.split(/\s+/).length > 45)
        flags.push({ rule: "dense-explanation", ...item });
      if (
        (item.tag === "button" || item.tag === "a") &&
        item.text.split(/\s+/).length > 5
      )
        flags.push({ rule: "long-action-label", ...item });
    }
    return {
      url: location.href,
      stringsInspected: unique.length,
      flags,
      note: "Read every flag in context. Rewrite shared humanizers or component copy, not a one-off screenshot string.",
    };
  });
}
