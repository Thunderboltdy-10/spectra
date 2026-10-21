"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { cn } from "@/lib/utils";
import { FeedbackFilePreview } from "./feedback-file-preview";

/*
 * Feedback beside the account row. Pressing it photographs the page as it is,
 * before the form covers anything, so the report shows what the person saw.
 */

type Kind = "issue" | "feature_request" | "improvement" | "other";

const KINDS: { value: Kind; label: string }[] = [
  { value: "issue", label: "Something's wrong" },
  { value: "improvement", label: "Could be better" },
  { value: "feature_request", label: "An idea" },
  { value: "other", label: "Other" },
];

const PROMPTS: Record<Kind, string> = {
  issue: "What happened, and what did you expect?",
  improvement: "What would make this better?",
  feature_request: "What would you like Spectra to do?",
  other: "Tell us anything.",
};

const MAX_FILES = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function photographPage(): Promise<Blob | null> {
  try {
    const { domToBlob } = await import("modern-screenshot");
    return await domToBlob(document.body, {
      type: "image/jpeg",
      quality: 0.82,
      scale: Math.min(1, 1600 / window.innerWidth),
      width: window.innerWidth,
      height: window.innerHeight,
      style: { transform: `translateY(-${window.scrollY}px)` },
    });
  } catch {
    // A page that cannot be drawn still deserves its feedback.
    return null;
  }
}

export function FeedbackButton({ collapsed }: { collapsed: boolean }) {
  const createUploadUrl = useMutation(api.administration.feedbackUploadUrl);
  const submit = useMutation(api.administration.submitFeedback);
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [kind, setKind] = useState<Kind>("issue");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [pagePath, setPagePath] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Each attached file shows as a picture of itself until the form closes.
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  function addFiles(incoming: Iterable<File>) {
    const accepted: File[] = [];
    let tooLarge = false;
    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) tooLarge = true;
      else accepted.push(file);
    }
    if (tooLarge) toast.message("Files over 25 MB stay out. A shorter recording or a smaller export works.");
    setFiles((current) => [...current, ...accepted].slice(0, MAX_FILES));
  }

  async function upload(blob: Blob) {
    const uploadUrl = await createUploadUrl({});
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!uploaded.ok) throw new Error("FEEDBACK_UPLOAD_FAILED: An attachment did not upload. Try again.");
    return ((await uploaded.json()) as { storageId: string }).storageId;
  }

  function forgetShot() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  }

  async function begin() {
    if (capturing) return;
    setCapturing(true);
    setPagePath(window.location.pathname + window.location.search);
    const blob = await photographPage();
    forgetShot();
    if (blob) setShot({ blob, url: URL.createObjectURL(blob) });
    setCapturing(false);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    forgetShot();
    setMessage("");
    setKind("issue");
    setFiles([]);
  }

  async function send() {
    const text = message.trim();
    if (text.length < 3 || sending) return;
    setSending(true);
    try {
      const [screenshotStorageId, attachments] = await Promise.all([
        shot ? upload(shot.blob).catch(() => undefined) : undefined,
        Promise.all(
          files.map(async (file) => ({
            storageId: (await upload(file)) as never,
            name: file.name,
            mediaType: file.type || "application/octet-stream",
            bytes: file.size,
          })),
        ),
      ]);
      const firstLine = text.split("\n")[0]!.trim();
      await submit({
        category: kind,
        sentiment: kind === "issue" ? "negative" : "neutral",
        subject: firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine,
        message: text,
        ...(screenshotStorageId ? { screenshotStorageId: screenshotStorageId as never } : {}),
        pagePath,
        ...(attachments.length ? { attachments } : {}),
      });
      toast.success("Feedback sent. Thank you.");
      close();
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "Your feedback was not sent. Try again." }).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Tooltip label="Send feedback" side={collapsed ? "right" : "top"}>
        <button
          type="button"
          aria-label="Send feedback"
          className={cn("feedback-trigger", capturing && "is-capturing")}
          onClick={() => void begin()}
          disabled={capturing}
        >
          <Icon name="conversations" size={16} aria-hidden="true" />
        </button>
      </Tooltip>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : sending ? undefined : close())}>
        <DialogContent className="feedback-dialog max-w-[520px] gap-0 p-5">
          <DialogTitle className="font-display text-title font-semibold">Send feedback</DialogTitle>
          <DialogDescription className="mt-1 text-caption text-[var(--text-secondary)]">
            It goes to the Spectra team with a picture of this page. Add your own screenshots,
            recordings or files too: they help us fix things much faster.
          </DialogDescription>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Segmented label="Kind of feedback" value={kind} onChange={setKind} options={KINDS} size="compact" />
            <Textarea
              onPaste={(event) => {
                const pasted = [...event.clipboardData.files];
                if (pasted.length) {
                  event.preventDefault();
                  addFiles(pasted);
                }
              }}
              aria-label="Your feedback"
              placeholder={PROMPTS[kind]}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={5000}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div
              className="feedback-files"
              data-dragging={dragging || undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              {files.length ? (
                <ul className="feedback-file-list">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`}>
                      <FeedbackFilePreview name={file.name} mediaType={file.type} url={previews[index]!} />
                      <span className="min-w-0">
                        <span className="block truncate">{file.name}</span>
                        <span className="block text-micro text-[var(--text-tertiary)]">{sizeLabel(file.size)}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
                      >
                        <Icon name="close" size={12} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {files.length < MAX_FILES ? (
                <button type="button" className="feedback-add-files" onClick={() => picker.current?.click()}>
                  <Icon name="attach" size={14} aria-hidden="true" />
                  {files.length ? "Add more" : "Add screenshots, recordings or files"}
                  <span className="text-[var(--text-tertiary)]">or drop or paste them here</span>
                </button>
              ) : null}
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.log,.zip"
                onChange={(event) => {
                  addFiles(event.target.files ?? []);
                  event.target.value = "";
                }}
              />
            </div>
            {shot ? (
              <figure className="feedback-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.url} alt="The page you were on" />
                <figcaption>
                  <span>Picture of this page</span>
                  <button type="button" onClick={forgetShot}>
                    Leave it out
                  </button>
                </figcaption>
              </figure>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close} disabled={sending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={sending || message.trim().length < 3}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
