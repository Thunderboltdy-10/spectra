async (page) => {
  return await page.evaluate(() => {
    const selection = getSelection();
    const node =
      selection?.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : selection?.anchorNode;
    const target = node instanceof Element ? node : document.activeElement;
    if (!(target instanceof Element)) {
      return {
        ready: false,
        reason: "Select styled content in the active editor first.",
      };
    }
    const style = getComputedStyle(target);
    const controls = [
      ...document.querySelectorAll(
        "button,[role=button],[role=combobox],select,input",
      ),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        const label = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.textContent || ""}`;
        return /(font|size|bold|italic|underline)/i.test(label);
      })
      .map((element) => ({
        label: (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.textContent ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 120),
        value: element.value ?? element.getAttribute("data-value") ?? null,
        pressed: element.getAttribute("aria-pressed"),
        selected: element.getAttribute("aria-selected"),
        disabled: element.matches(":disabled,[aria-disabled=true]"),
      }));
    const toolbarText = controls
      .map((control) => `${control.label} ${control.value || ""}`)
      .join(" ");
    const sizeMatch = /(?:font\s*)?(\d+(?:\.\d+)?)\s*(?:pt)?/i.exec(
      toolbarText,
    );
    const computedPoints = (Number.parseFloat(style.fontSize) * 72) / 96;
    const boldControl = controls.find((control) => /bold/i.test(control.label));
    const italicControl = controls.find((control) =>
      /italic/i.test(control.label),
    );
    const underlineControl = controls.find((control) =>
      /underline/i.test(control.label),
    );
    const pressed = (control) =>
      control
        ? control.pressed === "true" || control.selected === "true"
        : null;
    const computed = {
      fontFamily: style.fontFamily,
      fontSizePx: Number.parseFloat(style.fontSize),
      fontSizePt: computedPoints,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textDecorationLine: style.textDecorationLine,
    };
    const contradictions = [];
    if (sizeMatch && Math.abs(Number(sizeMatch[1]) - computedPoints) > 0.8) {
      contradictions.push(
        `Toolbar size ${sizeMatch[1]} does not match rendered ${computedPoints.toFixed(2)}pt.`,
      );
    }
    const renderedBold =
      Number(style.fontWeight) >= 600 || /bold/i.test(style.fontWeight);
    if (pressed(boldControl) !== null && pressed(boldControl) !== renderedBold)
      contradictions.push("Bold control and rendered weight disagree.");
    if (
      pressed(italicControl) !== null &&
      pressed(italicControl) !== (style.fontStyle !== "normal")
    )
      contradictions.push("Italic control and rendered style disagree.");
    if (
      pressed(underlineControl) !== null &&
      pressed(underlineControl) !==
        style.textDecorationLine.includes("underline")
    )
      contradictions.push(
        "Underline control and rendered decoration disagree.",
      );
    return {
      ready: true,
      url: location.href,
      selection: selection?.toString().slice(0, 160) || "",
      target: target.tagName.toLowerCase(),
      computed,
      controls,
      contradictions,
      note: "Pair this DOM canary with semantic projection and durable/native package readback.",
    };
  });
}
