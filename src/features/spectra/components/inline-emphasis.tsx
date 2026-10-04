import { emphasisSegments } from "../ai/inline-emphasis";

/** Text whose *emphasis* markers render as italics, never as raw asterisks. */
export function InlineEmphasis({ text }: { text: string }) {
  return (
    <>
      {emphasisSegments(text).map((segment, index) =>
        segment.emphasis ? <em key={index}>{segment.text}</em> : segment.text,
      )}
    </>
  );
}
