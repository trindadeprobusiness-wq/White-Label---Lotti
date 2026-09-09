import type { ReactNode } from 'react'

interface PageTitleProps {
  children: ReactNode
  icon?: ReactNode
}

export function PageTitle({ children, icon }: PageTitleProps) {
  return (
    <h1 className="flex items-center gap-2 text-2xl font-semibold leading-tight tracking-tight">
      {icon}
      {children}
    </h1>
  )
}
