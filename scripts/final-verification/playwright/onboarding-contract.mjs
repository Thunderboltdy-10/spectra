async (page) => {
  return await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 1 &&
        rect.height > 1
      );
    };
    const text = document.body.innerText.replace(/\s+/g, " ").trim();
    const controls = [
      ...document.querySelectorAll(
        "button,input,[role=checkbox],[role=option],[role=combobox],a",
      ),
    ]
      .filter(visible)
      .map((element) => ({
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        label: (
          element.getAttribute("aria-label") ||
          element.textContent ||
          element.getAttribute("placeholder") ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 140),
        checked:
          element.getAttribute("aria-checked") ?? element.checked ?? null,
        disabled: element.matches(":disabled,[aria-disabled=true]"),
      }));
    const classControls = controls.filter((control) =>
      /(class|course|subject)/i.test(control.label),
    );
    const choiceControls = controls.filter(
      (control) =>
        ["checkbox", "option"].includes(control.role) ||
        control.checked !== null,
    );
    const hasSkip = controls.some((control) =>
      /skip|later|not now/i.test(control.label),
    );
    const hasSearch = controls.some((control) =>
      /search.*(class|course|subject)|(class|course|subject).*search/i.test(
        control.label,
      ),
    );
    const technicalCopy = [
      ...new Set(
        text.match(
          /\b(?:recordId|providerId|capability|manifest|projection|replica|materialize|tenant|enum|sync strategy)\b/gi,
        ) || [],
      ),
    ];
    return {
      url: location.href,
      heading: document.querySelector("h1,h2")?.textContent?.trim() || null,
      classControls: classControls.length,
      choiceControls: choiceControls.length,
      hasSearch,
      hasSkip,
      technicalCopy,
      controls,
      heuristicPass:
        classControls.length > 0 &&
        choiceControls.length > 0 &&
        hasSkip &&
        technicalCopy.length === 0,
      note: "Also prove idempotent submit, selected shelf truth, and later editability from School or ManageBac plus Settings.",
    };
  });
}
