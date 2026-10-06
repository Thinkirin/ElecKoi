import { useEffect, useState } from "react";
import { CaretRight, ChatCircle, PencilSimple } from "@phosphor-icons/react";
import logoIcon from "../../../assets/eleckoi-app-icon.png";
import { assetSrc } from "../../../app/services/assets.js";
import { EditorHeader } from "../../../ui/ui/EditorHeader.jsx";
import { characterCover, characterName } from "./characterUtils.js";
import {
  characterDeckKeyDirection,
  hasBlockingCharacterOverlay,
  preventPointerFocus,
} from "./characterProfileKeyboard.js";

function wrappedDistance(index, selectedIndex, total) {
  if (total < 2) return 0;
  let distance = index - selectedIndex;
  const half = total / 2;
  if (distance > half) distance -= total;
  if (distance < -half) distance += total;
  return distance;
}

function CharacterDeckCard({ character, onSelect }) {
  const name = characterName(character);
  const cover = assetSrc(characterCover(character));
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
  }, [cover]);

  return (
    <button
      type="button"
      className="character-deck-card"
      aria-label={`查看${name}`}
      aria-pressed="true"
      onMouseDown={preventPointerFocus}
      onClick={() => onSelect(character.id)}
    >
      <span className="character-deck-card-art">
        {cover && !coverFailed ? (
          <img src={cover} alt="" draggable="false" onError={() => setCoverFailed(true)} />
        ) : (
          <span aria-hidden="true">{name.slice(0, 1)}</span>
        )}
      </span>
    </button>
  );
}

export function CharacterProfilePanel({
  characters,
  selectedCharacterId,
  onSelectCharacter,
  onStartConversation,
  onEditCharacter,
  onCreateFirstCharacter,
  onBack,
}) {
  const items = characters?.items || [];
  const requestedIndex = Math.max(0, items.findIndex((item) => item.id === selectedCharacterId));
  const requestedCharacter = items[requestedIndex] || null;
  const [displayedCharacterId, setDisplayedCharacterId] = useState(() => requestedCharacter?.id || "");
  const [remoteSwitching, setRemoteSwitching] = useState(false);
  const displayedIndex = items.findIndex((item) => item.id === displayedCharacterId);
  const selectedIndex = displayedIndex >= 0 ? displayedIndex : requestedIndex;
  const selectedCharacter = items[selectedIndex] || null;
  const renderProfile = panel => (
    <section className="character-profile-detail">
      {onBack ? <EditorHeader className="character-profile-mobile-header" title="角色" onBack={onBack} backLabel="返回角色列表" /> : null}
      {panel}
    </section>
  );

  useEffect(() => {
    const targetId = requestedCharacter?.id || "";
    if (!targetId || targetId === displayedCharacterId) {
      setRemoteSwitching(false);
      if (!targetId && displayedCharacterId) setDisplayedCharacterId("");
      return undefined;
    }

    const fromIndex = items.findIndex((item) => item.id === displayedCharacterId);
    const distance = fromIndex >= 0
      ? Math.abs(wrappedDistance(requestedIndex, fromIndex, items.length))
      : Number.POSITIVE_INFINITY;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (distance <= 2 || reduceMotion) {
      setRemoteSwitching(false);
      setDisplayedCharacterId(targetId);
      return undefined;
    }

    setRemoteSwitching(true);
    const timer = window.setTimeout(() => {
      setDisplayedCharacterId(targetId);
      setRemoteSwitching(false);
    }, 90);

    return () => window.clearTimeout(timer);
  }, [displayedCharacterId, items, requestedCharacter?.id, requestedIndex]);

  function moveSelection(direction) {
    if (items.length < 2) return;
    const nextIndex = (selectedIndex + direction + items.length) % items.length;
    onSelectCharacter(items[nextIndex].id);
  }

  useEffect(() => {
    if (items.length < 2) return undefined;

    function handleWindowKeyDown(event) {
      const direction = characterDeckKeyDirection(event, hasBlockingCharacterOverlay(document));
      if (!direction) return;
      event.preventDefault();
      moveSelection(direction);
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [items, selectedIndex, onSelectCharacter]);

  if (!selectedCharacter) {
    return renderProfile(
      <section className="character-profile-panel character-profile-empty" aria-label="角色简介">
        <div className="chat-empty-guide">
          <img src={logoIcon} alt="" draggable="false" />
          <strong>还没有角色</strong>
          <span>先创建一个角色，再开始第一段对话。</span>
          <button type="button" onMouseDown={preventPointerFocus} onClick={onCreateFirstCharacter}>新建角色</button>
        </div>
      </section>
    );
  }

  const name = characterName(selectedCharacter);
  const introduction = String(
    selectedCharacter.description
      || selectedCharacter.profileDescription
      || selectedCharacter.profileLike
      || "",
  ).trim();

  return renderProfile(
    <section className="character-profile-panel" aria-label={`${name}的角色简介`} aria-busy={remoteSwitching || undefined}>
      <div
        className={`character-deck${remoteSwitching ? " is-remote-switching" : ""}`}
        aria-label="角色卡切换"
      >
        <CharacterDeckCard key={selectedCharacter.id} character={selectedCharacter} onSelect={onSelectCharacter} />

        {items.length > 1 ? (
          <>
            <button type="button" className="character-deck-arrow is-previous" aria-label="上一个角色" onMouseDown={preventPointerFocus} onClick={() => moveSelection(-1)}>
              <CaretRight size={18} />
            </button>
            <button type="button" className="character-deck-arrow is-next" aria-label="下一个角色" onMouseDown={preventPointerFocus} onClick={() => moveSelection(1)}>
              <CaretRight size={18} />
            </button>
          </>
        ) : null}

      </div>

      <div className={`character-profile-copy${remoteSwitching ? " is-remote-switching" : ""}`}>
        <div className="character-profile-heading"><h1>{name}</h1><span>{selectedIndex + 1} / {items.length}</span></div>
        <p className={introduction ? "" : "is-empty"}>{introduction || "暂无简介"}</p>
      </div>

      <div className="character-profile-actions">
        <button type="button" className="character-profile-action is-primary" onMouseDown={preventPointerFocus} onClick={() => onStartConversation(selectedCharacter.id)}>
          <ChatCircle size={18} />
          开始对话
        </button>
        <button type="button" className="character-profile-action is-secondary" onMouseDown={preventPointerFocus} onClick={() => onEditCharacter(selectedCharacter.id)}>
          <PencilSimple size={18} />
          编辑角色
        </button>
      </div>

    </section>
  );
}
