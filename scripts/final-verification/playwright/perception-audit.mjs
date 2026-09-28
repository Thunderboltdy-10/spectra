async (page) => {
  return await page.evaluate(async () => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) > 0.02 &&
        rect.width > 1 &&
        rect.height > 1
      );
    };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      };
    };
    const labelOf = (element) =>
      (
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent ||
        element.tagName
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 140);
    const selectorOf = (element) => {
      const id = element.id ? `#${element.id}` : "";
      const classes =
        typeof element.className === "string"
          ? element.className
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 4)
              .map((name) => `.${name}`)
              .join("")
          : "";
      return `${element.tagName.toLowerCase()}${id}${classes}`.slice(0, 220);
    };
    const overlap = (a, b) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const all = [...document.querySelectorAll("body *")].filter(visible);
    const overlays = all.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        (style.position === "fixed" || style.position === "sticky") &&
        rect.bottom >= innerHeight - 2 &&
        rect.height >= 24 &&
        rect.height < innerHeight * 0.45
      );
    });
    const scrollCandidates = [
      ...new Set([
        ...document.querySelectorAll(
          "main,[role=main],[data-scroll-root],.ProseMirror,.tiptap,[class*='studio'],[class*='scroll']",
        ),
      ]),
    ]
      .filter((element) => {
        if (!visible(element)) return false;
        const style = getComputedStyle(element);
        return (
          element.scrollHeight > element.clientHeight + 8 &&
          /(auto|scroll)/.test(style.overflowY)
        );
      })
      .slice(0, 24);
    const bottomOcclusion = [];
    for (const root of scrollCandidates) {
      const previous = root.scrollTop;
      root.scrollTop = root.scrollHeight;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const rootRect = root.getBoundingClientRect();
      const meaningful = [
        ...root.querySelectorAll(
          "p,li,tr,[contenteditable=true],[data-node-view-content],canvas,svg,img",
        ),
      ].filter(visible);
      const last = meaningful.sort(
        (left, right) =>
          right.getBoundingClientRect().bottom -
          left.getBoundingClientRect().bottom,
      )[0];
      const lastRect = last ? last.getBoundingClientRect() : null;
      const blockers = overlays
        .filter(
          (element) =>
            !root.contains(element) &&
            overlap(rootRect, element.getBoundingClientRect()) > 0,
        )
        .map((element) => ({
          selector: selectorOf(element),
          label: labelOf(element),
          rect: rectOf(element),
        }));
      const blockerTop = blockers.length
        ? Math.min(...blockers.map((item) => item.rect.top))
        : rootRect.bottom;
      const occludedPx = lastRect
        ? Math.max(0, lastRect.bottom - blockerTop)
        : 0;
      bottomOcclusion.push({
        root: selectorOf(root),
        scrollTop: root.scrollTop,
        maxScrollTop: root.scrollHeight - root.clientHeight,
        last: last
          ? {
              selector: selectorOf(last),
              label: labelOf(last),
              rect: rectOf(last),
            }
          : null,
        blockers,
        occludedPx,
        pass: occludedPx <= 1,
      });
      root.scrollTop = previous;
    }
    const cornerButtons = all.filter((element) => {
      if (!element.matches("button,a,[role=button]")) return false;
      const rect = element.getBoundingClientRect();
      return rect.left >= innerWidth * 0.68 && rect.top <= innerHeight * 0.22;
    });
    const cornerOwners = new Map();
    for (const button of cornerButtons) {
      const owner =
        button.closest(
          "header,[role=toolbar],[role=dialog],aside,[class*='header'],[class*='chrome']",
        ) || button.parentElement;
      const key = owner ? selectorOf(owner) : "unknown";
      if (!cornerOwners.has(key)) cornerOwners.set(key, []);
      cornerOwners
        .get(key)
        .push({
          label: labelOf(button),
          rect: rectOf(button),
          named: Boolean(
            button.getAttribute("aria-label") || button.textContent?.trim(),
          ),
        });
    }
    const toolbars = [
      ...document.querySelectorAll(
        "[role=toolbar],header,[class*='toolbar'],[class*='workbar']",
      ),
    ]
      .filter(visible)
      .slice(0, 40)
      .map((row) => {
        const rowRect = row.getBoundingClientRect();
        const children = [...row.children].filter(visible);
        const centers = children.map((child) => {
          const rect = child.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        const overflowed = children.filter((child) => {
          const rect = child.getBoundingClientRect();
          return (
            rect.left < rowRect.left - 1 ||
            rect.right > rowRect.right + 1 ||
            rect.top < rowRect.top - 1 ||
            rect.bottom > rowRect.bottom + 1
          );
        });
        const baselineSpreadPx = centers.length
          ? Math.max(...centers) - Math.min(...centers)
          : 0;
        return {
          row: selectorOf(row),
          label: labelOf(row),
          rect: rectOf(row),
          childCount: children.length,
          baselineSpreadPx,
          overflowed: overflowed.map((child) => ({
            selector: selectorOf(child),
            label: labelOf(child),
            rect: rectOf(child),
          })),
          scrollOverflowX: row.scrollWidth - row.clientWidth,
          pass: baselineSpreadPx <= 8 && overflowed.length === 0,
        };
      });
    const panels = [
      ...document.querySelectorAll(
        "aside,[role=complementary],[role=dialog],[aria-label*='comment' i],[aria-label*='embed' i],[class*='comments'],[class*='panel']",
      ),
    ]
      .filter(visible)
      .slice(0, 40)
      .map((panel) => {
        const rect = panel.getBoundingClientRect();
        const style = getComputedStyle(panel);
        const work = document.querySelector(
          "main,[role=main],.ProseMirror,.tiptap,[class*='studio']",
        );
        const workRect =
          work && visible(work) ? work.getBoundingClientRect() : null;
        const overlapArea = workRect ? overlap(rect, workRect) : 0;
        const workArea = workRect
          ? Math.max(1, workRect.width * workRect.height)
          : 1;
        return {
          panel: selectorOf(panel),
          label: labelOf(panel),
          rect: rectOf(panel),
          position: style.position,
          backdropFilter:
            style.backdropFilter || style.webkitBackdropFilter || "none",
          filter: style.filter,
          overlapWithWorkPercent: (overlapArea / workArea) * 100,
          likelyOverlay:
            ["fixed", "absolute"].includes(style.position) && overlapArea > 0,
        };
      });
    const stateEffects = all
      .filter((element) => {
        const signature = `${element.id} ${typeof element.className === "string" ? element.className : ""} ${element.getAttribute("data-testid") || ""}`;
        return /(claim|conflict|gate|region|highlight|field|selection)/i.test(
          signature,
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const areaPercent =
          ((rect.width * rect.height) / (innerWidth * innerHeight)) * 100;
        return {
          selector: selectorOf(element),
          label: labelOf(element),
          rect: rectOf(element),
          areaPercent,
        };
      })
      .filter((item) => item.areaPercent >= 12)
      .sort((left, right) => right.areaPercent - left.areaPercent)
      .slice(0, 30);
    const fonts = new Map();
    for (const element of all
      .filter((element) =>
        /^(P|SPAN|DIV|BUTTON|INPUT|H1|H2|H3|TD|TH)$/.test(element.tagName),
      )
      .slice(0, 4000)) {
      const style = getComputedStyle(element);
      const key = `${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.lineHeight}`;
      fonts.set(key, (fonts.get(key) || 0) + 1);
    }
    const unnamedControls = all
      .filter(
        (element) =>
          element.matches(
            "button,a,[role=button],[role=checkbox],[role=switch]",
          ) && !labelOf(element),
      )
      .map(selectorOf)
      .slice(0, 100);
    return {
      capturedAt: new Date().toISOString(),
      url: location.href,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      bottomOcclusion,
      topRight: {
        controls: cornerButtons.length,
        owners: [...cornerOwners.entries()].map(([owner, controls]) => ({
          owner,
          controls,
        })),
        competingOwnerCount: cornerOwners.size,
      },
      toolbars,
      panels,
      oversizedStateEffects: stateEffects,
      typography: [...fonts.entries()]
        .map(([signature, count]) => ({ signature, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 40),
      unnamedControls,
      heuristicFailures: {
        occludedScrollRoots: bottomOcclusion.filter((item) => !item.pass)
          .length,
        misalignedOrOverflowingRows: toolbars.filter((item) => !item.pass)
          .length,
        overlayPanels: panels.filter(
          (item) => item.likelyOverlay && item.overlapWithWorkPercent > 5,
        ).length,
        oversizedStateEffects: stateEffects.length,
        unnamedControls: unnamedControls.length,
      },
      note: "Heuristic flags require full-frame human review; they do not pass or fail a card by themselves.",
    };
  });
}
