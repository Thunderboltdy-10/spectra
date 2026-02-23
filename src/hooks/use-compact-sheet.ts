"use client";

import { useEffect, useState } from "react";

export function useCompactSheet(threshold = 820) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const update = () => {
      setCompact(window.innerWidth <= threshold || window.innerHeight <= 720);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [threshold]);

  return compact;
}
