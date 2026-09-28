async (page) => {
  const dialog = page.getByRole("dialog");
  const text = (await dialog.count())
    ? await dialog.first().innerText()
    : "";
  return {
    hasPablo: /Pablo MD/i.test(text),
    onlyYou: /Only you have access/i.test(text),
    people: text.slice(0, 500),
  };
}
