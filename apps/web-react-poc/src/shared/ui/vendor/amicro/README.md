# Amicro AddToCartMorph

Original component by SYED SUBHAN UDDIN, MIT license.

Downloaded from https://raw.githubusercontent.com/Subhan-code/Amicro--Micro-transitions-/main/src/components/morphing/AddToCartMorph.tsx on 2026-10-21.
Registry: `@amicro/add-to-cart-morph` (https://amicro.vercel.app/r/add-to-cart-morph.json).
The shadcn registry connection timed out; the author's original component was downloaded from GitHub instead. The original source is preserved in `AddToCartMorph.original.tsx.txt` alongside its license.

`../../comparison-morph.tsx` retains the original Motion springs, 1400 ms confirmation, animated labels, tap feedback, badge, and flying +1 counter. Changes: Scale instead of ShoppingCart, Russian comparison labels, real comparison storage and selection limit, timer cleanup, reduced motion, and equivalent CSS Modules styles instead of Tailwind utilities. The reset button removes the current program. Per the requested layout, the scales and shared counter live in the header (`../../comparison-indicator.tsx`), left of the menu button; the +1 particle uses a fixed portal with the original 340/28 spring to fly from the clicked action to the header target instead of using the original local shared layout ID.
