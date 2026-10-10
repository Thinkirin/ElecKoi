import { createPortal } from "react-dom";
import { CHAT_IMAGE_LIMITS } from "@shared/contracts/agent/imageLimits";

export function ChatDropOverlay({ disabled }) {
  return createPortal(
    <div className="chat-image-drop-overlay" role="status">
      <div className="chat-image-drop-overlay-content">
        <svg className="chat-image-drop-illustration" width="115" height="84" viewBox="0 0 115 84" fill="none" aria-hidden="true">
          <rect x="4" y="12" width="44" height="44" rx="12" transform="rotate(-23 4 12)" fill="#9CE5ED" />
          <rect x="73" y="9" width="44" height="51" rx="8" transform="rotate(17 73 9)" fill="#679EFE" />
          <path d="M24 19l13 18M37 19L24 37" stroke="white" strokeWidth="3" />
          <path d="M77 27l24 8M74 35l24 8M72 43l14 5" stroke="white" strokeWidth="3" />
          <rect x="32" y="39" width="45" height="44" rx="12" fill="#3964FE" />
          <path d="M39 73l7-15 6 12 8-8 9 10" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="60" cy="52" r="4.4" fill="white" />
        </svg>
        <div className="chat-image-drop-title">
          {disabled ? "当前无法添加文件或图片" : "文件或图片拖动到此处即可添加"}
        </div>
        {!disabled && <div className="chat-image-drop-description">
          图片限制：最多 {CHAT_IMAGE_LIMITS.maxImagesPerMessage} 张，每张 20MB
        </div>}
      </div>
    </div>,
    document.body,
  );
}
