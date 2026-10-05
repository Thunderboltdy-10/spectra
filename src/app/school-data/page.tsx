import { redirect } from "next/navigation";

// School data moved into School; old links land there.
export default function SchoolDataPage(): never {
  redirect("/school");
}
