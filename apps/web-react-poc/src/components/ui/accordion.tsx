import * as AccordionPrimitive from "@radix-ui/react-accordion";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import styles from "./accordion.module.css";

type RootProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>;

const Accordion = forwardRef<ElementRef<typeof AccordionPrimitive.Root>, RootProps>(
  ({ className, ...props }, ref) => (
    <AccordionPrimitive.Root
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(" ")}
      {...props}
    />
  ),
);
Accordion.displayName = AccordionPrimitive.Root.displayName;

type ItemProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>;

const AccordionItem = forwardRef<ElementRef<typeof AccordionPrimitive.Item>, ItemProps>(
  ({ className, ...props }, ref) => (
    <AccordionPrimitive.Item
      ref={ref}
      className={[styles.item, className].filter(Boolean).join(" ")}
      {...props}
    />
  ),
);
AccordionItem.displayName = AccordionPrimitive.Item.displayName;

type TriggerProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>;

const AccordionTrigger = forwardRef<ElementRef<typeof AccordionPrimitive.Trigger>, TriggerProps>(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Header className={styles.header}>
      <AccordionPrimitive.Trigger
        ref={ref}
        className={[styles.trigger, className].filter(Boolean).join(" ")}
        {...props}
      >
        {children}
        <span className={styles.indicator} aria-hidden="true" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  ),
);
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

type ContentProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>;

const AccordionContent = forwardRef<ElementRef<typeof AccordionPrimitive.Content>, ContentProps>(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Content
      ref={ref}
      className={[styles.content, className].filter(Boolean).join(" ")}
      {...props}
    >
      <div className={styles.contentBody}>{children}</div>
    </AccordionPrimitive.Content>
  ),
);
AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
