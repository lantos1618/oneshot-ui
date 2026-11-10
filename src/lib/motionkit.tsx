/**
 * The parts of motion (`motion/react`, an optional peer dependency) that the extras animate with. Core has no motion;
 * every extras module takes these names from here, so the reduced-motion switch below always loads with them. Not part
 * of the public API.
 */
import { AnimatePresence as FmAnimatePresence, LayoutGroup as FmLayoutGroup, MotionGlobalConfig, animate as fmAnimate, cubicBezier as fmCubicBezier, motion as fmMotion, useAnimate as fmUseAnimate, useMotionValue as fmUseMotionValue, type Transition as FmTransition } from 'motion/react'
import { REDUCED_MOTION_Q } from './core'

/**
 * UIProvider has no MotionConfig any more: for people who ask for reduced motion, motion's animations jump to their end
 * (core's CSS animations tone themselves down). An app that would rather keep motion's fades wraps the extras in
 * `<MotionConfig reducedMotion="user">` and sets `MotionGlobalConfig.skipAnimations = false`.
 */
function motionkitFollowReducedMotion() {
  if (typeof matchMedia === 'undefined') return
  const reduce = matchMedia(REDUCED_MOTION_Q), sync = () => { MotionGlobalConfig.skipAnimations = reduce.matches }
  sync()
  reduce.addEventListener?.('change', sync)
}

/** motion's `motion` components. Its first use turns on the reduced-motion switch (a module that animates always uses it). */
export const motion: typeof fmMotion = (motionkitFollowReducedMotion(), fmMotion)
export const AnimatePresence: typeof FmAnimatePresence = FmAnimatePresence
export const LayoutGroup: typeof FmLayoutGroup = FmLayoutGroup
export const animate: typeof fmAnimate = fmAnimate
export const cubicBezier: typeof fmCubicBezier = fmCubicBezier
export const useAnimate: typeof fmUseAnimate = fmUseAnimate
export const useMotionValue: typeof fmUseMotionValue = fmUseMotionValue
export type Transition = FmTransition
