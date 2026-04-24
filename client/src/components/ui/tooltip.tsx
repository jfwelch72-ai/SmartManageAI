"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    /**
     * When true (default), the tooltip is rendered into a portal at the
     * document body so it cannot be clipped or covered by ancestor
     * containers with `overflow: hidden`, transforms, or competing
     * stacking contexts (e.g. side panels, drawers, takeoff toolbars).
     * Set to false if you intentionally need the tooltip rendered
     * inline (rare).
     */
    portal?: boolean
  }
>(({ className, sideOffset = 6, collisionPadding = 8, portal = true, ...props }, ref) => {
  const content = (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      avoidCollisions
      className={cn(
        "z-[10001] max-w-xs overflow-hidden whitespace-normal break-words rounded-md border border-border/50 bg-foreground px-3 py-1.5 text-xs font-medium leading-snug text-background shadow-lg ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  )
  return portal ? <TooltipPrimitive.Portal>{content}</TooltipPrimitive.Portal> : content
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
