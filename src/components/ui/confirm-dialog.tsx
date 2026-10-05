"use client";

import * as React from "react";
import { Loader2 } from "@/components/icons/glyph-icons";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import type { SpectraLayer } from "./layers";

/**
 * Spectra's one confirmation: a question, what will happen, and two answers.
 *
 * It is an `alertdialog` on the shared Dialog, so it inherits the one overlay,
 * the layer contract, the focus trap and focus return. Focus starts on the
 * safe answer (Cancel), so Enter never confirms a destructive action by
 * accident. While `pending`, both answers are disabled and the dialog cannot
 * be dismissed, so an in-flight action cannot be abandoned half-way.
 */
export function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  confirmDisabled = false,
  layer = "modal",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** The confirmed action is running: nothing can be answered or dismissed. */
  pending?: boolean;
  /** The action is not possible; `detail` must say why. */
  confirmDisabled?: boolean;
  layer?: SpectraLayer;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <DialogContent
        role="alertdialog"
        layer={layer}
        hideCloseButton
        className="max-w-[380px] gap-5 p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{detail}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
