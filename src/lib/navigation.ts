import {
  BarChart3,
  BookOpen,
  Bot,
  Inbox,
  LayoutDashboard,
  Plug,
  Workflow,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Navegación primaria deliberadamente corta. Las rutas de configuración,
 * cuenta, agenda y catálogo siguen existiendo, pero se abren desde el lugar
 * contextual correspondiente en vez de competir en la sidebar.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, exact: true },
      { href: "/dashboard/conversaciones", label: "Conversaciones", icon: Inbox },
    ],
  },
  {
    label: "Agente IA",
    items: [
      { href: "/dashboard/agente", label: "Agente", icon: Bot },
      { href: "/dashboard/conocimiento", label: "Conocimiento", icon: BookOpen },
      {
        href: "/dashboard/automatizaciones",
        label: "Automatizaciones",
        icon: Workflow,
      },
    ],
  },
  {
    label: "Gestión",
    items: [
      { href: "/dashboard/integraciones", label: "Integraciones", icon: Plug },
      { href: "/dashboard/metricas", label: "Métricas", icon: BarChart3 },
    ],
  },
];

/** Lista plana para navegación activa y breadcrumbs principales. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
