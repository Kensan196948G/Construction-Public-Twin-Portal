"use client";

import { useEffect } from "react";

import { useAppStore } from "@/lib/store/useAppStore";

/** 画面下に一時的なメッセージを表示する。 */
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const clearToast = useAppStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => clearToast(), 3200);
    return () => window.clearTimeout(id);
  }, [toast, clearToast]);

  return (
    <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
      {toast?.message ?? ""}
    </div>
  );
}
