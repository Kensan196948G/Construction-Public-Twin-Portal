"use client";

/**
 * 3D ビューアのエラーバウンダリ。
 *
 * WebGL の初期化失敗や three.js の想定外例外で画面全体が落ちないよう、
 * Canvas 配下の例外を捕捉してフォールバック UI に差し替える。
 * 例外の詳細はコンソールへ warning として残す（握りつぶさない）。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ViewerErrorBoundaryProps {
  children: ReactNode;
  /** 例外発生時に呼ばれる（ログ・状態表示用） */
  onError: (message: string) => void;
  /** 差し替えるフォールバック UI */
  fallback: ReactNode;
}

interface ViewerErrorBoundaryState {
  failed: boolean;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "不明なエラー";
}

export class ViewerErrorBoundary extends Component<
  ViewerErrorBoundaryProps,
  ViewerErrorBoundaryState
> {
  state: ViewerErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ViewerErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn("[viewer3d] 3Dビューアで例外が発生しました。フォールバック表示に切り替えます。", error, info.componentStack);
    this.props.onError(toMessage(error));
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
