"use client";

import React from "react";
import Image from "next/image";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

export type TestimonialColumnItem = {
  text: string;
  image: string;
  name: string;
  role: string;
};

export function TestimonialsColumn({
  className,
  testimonials,
  duration = 10,
}: {
  className?: string;
  testimonials: TestimonialColumnItem[];
  duration?: number;
}) {
  return (
    <div className={cn("overflow-hidden", className)}>
      <motion.div
        animate={{ translateY: "-50%" }}
        transition={{
          duration,
          repeat: Infinity,
          ease: "linear",
          repeatType: "loop",
        }}
        className="flex flex-col gap-5 pb-5"
      >
        {Array.from({ length: 2 }).map((_, index) => (
          <React.Fragment key={index}>
            {testimonials.map(({ text, image, name, role }) => (
              <div
                className="w-full max-w-xs rounded-xl border border-white/10 bg-[#111111] p-5 text-left shadow-[0_24px_70px_rgba(0,0,0,0.30)]"
                key={`${name}-${role}-${index}`}
              >
                <div className="relative h-32 overflow-hidden rounded-lg border border-white/8 bg-black">
                  <Image
                    width={320}
                    height={160}
                    src={image}
                    alt=""
                    className="h-full w-full object-cover opacity-82"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/62 to-transparent" />
                </div>
                <p className="mt-4 text-sm leading-6 text-white/70">{text}</p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-full bg-red-600 text-sm font-black text-white">
                    {name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")}
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <div className="truncate text-sm font-semibold leading-5 text-white">{name}</div>
                    <div className="truncate text-xs leading-5 text-red-300/70">{role}</div>
                  </div>
                </div>
              </div>
            ))}
          </React.Fragment>
        ))}
      </motion.div>
    </div>
  );
}
