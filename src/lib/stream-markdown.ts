export function autoCloseMarkdown(input: string) {
  let value = input;

  const fenceCount = (value.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    value += "\n```";
  }

  const boldCount = (value.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 === 1) {
    value += "**";
  }

  const inlineCodeCount = (value.match(/`/g) ?? []).length - fenceCount * 3;
  if (inlineCodeCount % 2 === 1) {
    value += "`";
  }

  return value;
}
