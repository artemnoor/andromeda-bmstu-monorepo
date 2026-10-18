import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AnimatePresence,
  motion,
  type Target,
  type TargetAndTransition,
  type Transition,
  type VariantLabels,
} from "motion/react";
import styles from "./rotating-text.module.css";

type RotatingTextProps = {
  texts: string[];
  transition?: Transition;
  initial?: boolean | Target | VariantLabels;
  animate?: boolean | VariantLabels | TargetAndTransition;
  exit?: Target | VariantLabels;
  animatePresenceMode?: "sync" | "wait";
  animatePresenceInitial?: boolean;
  rotationInterval?: number;
  staggerDuration?: number;
  staggerFrom?: "first" | "last" | "center" | "random" | number;
  loop?: boolean;
  auto?: boolean;
  splitBy?: string;
  onNext?: (index: number) => void;
  mainClassName?: string;
  splitLevelClassName?: string;
  elementLevelClassName?: string;
};

export function RotatingText({
  texts,
  transition = { type: "spring", damping: 25, stiffness: 300 },
  initial = { y: "100%", opacity: 0 },
  animate = { y: 0, opacity: 1 },
  exit = { y: "-120%", opacity: 0 },
  animatePresenceMode = "wait",
  animatePresenceInitial = false,
  rotationInterval = 2000,
  staggerDuration = 0,
  staggerFrom = "first",
  loop = true,
  auto = true,
  splitBy = "characters",
  onNext,
  mainClassName,
  splitLevelClassName,
  elementLevelClassName,
}: RotatingTextProps) {
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const currentText = texts[currentTextIndex] ?? "";

  const elements = useMemo(() => {
    if (splitBy === "characters") {
      return currentText.split(" ").map((word, index, words) => ({
        characters: Array.from(word),
        needsSpace: index !== words.length - 1,
      }));
    }

    const segments = splitBy === "words" ? currentText.split(" ") : currentText.split(splitBy);
    return segments.map((segment, index) => ({
      characters: [segment],
      needsSpace: index !== segments.length - 1,
    }));
  }, [currentText, splitBy]);

  const getStaggerDelay = useCallback(
    (index: number, total: number) => {
      if (staggerFrom === "first") return index * staggerDuration;
      if (staggerFrom === "last") return (total - 1 - index) * staggerDuration;
      if (staggerFrom === "center") return Math.abs(Math.floor(total / 2) - index) * staggerDuration;
      if (staggerFrom === "random") {
        return Math.abs(Math.floor(Math.random() * total) - index) * staggerDuration;
      }
      return Math.abs(staggerFrom - index) * staggerDuration;
    },
    [staggerDuration, staggerFrom],
  );

  const next = useCallback(() => {
    setCurrentTextIndex((index) => {
      const nextIndex = index === texts.length - 1 ? (loop ? 0 : index) : index + 1;
      if (nextIndex !== index) onNext?.(nextIndex);
      return nextIndex;
    });
  }, [loop, onNext, texts.length]);

  useEffect(() => {
    if (!auto || texts.length < 2) return;
    const intervalId = window.setInterval(next, rotationInterval);
    return () => window.clearInterval(intervalId);
  }, [auto, next, rotationInterval, texts.length]);

  if (texts.length === 0) return null;

  return (
    <motion.span
      className={`${styles.root} ${mainClassName ?? ""}`}
      layout
      transition={transition}
    >
      <span className={styles.srOnly}>{currentText}</span>
      <AnimatePresence mode={animatePresenceMode} initial={animatePresenceInitial}>
        <motion.span
          key={currentTextIndex}
          className={splitBy === "lines" ? styles.lines : styles.inner}
          layout
          aria-hidden="true"
        >
          {elements.map((word, wordIndex) => {
            const previousCharacters = elements
              .slice(0, wordIndex)
              .reduce((count, item) => count + item.characters.length, 0);
            const totalCharacters = elements.reduce((count, item) => count + item.characters.length, 0);

            return (
              <span
                key={wordIndex}
                className={`${styles.word} ${splitLevelClassName ?? ""}`}
              >
                {word.characters.map((character, characterIndex) => (
                  <motion.span
                    key={characterIndex}
                    initial={initial}
                    animate={animate}
                    exit={exit}
                    transition={{
                      ...transition,
                      delay: getStaggerDelay(previousCharacters + characterIndex, totalCharacters),
                    }}
                    className={`${styles.character} ${elementLevelClassName ?? ""}`}
                  >
                    {character}
                  </motion.span>
                ))}
                {word.needsSpace && <span className={styles.space}> </span>}
              </span>
            );
          })}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
