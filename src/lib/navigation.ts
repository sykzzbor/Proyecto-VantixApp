import {
  BarChart3,
  BookOpen,
  Bot,
  Briefcase,
  CalendarClock,
  CircleHelp,
  CreditCard,
  Inbox,
  LayoutDashboard,
  MessageCircleQuestion,
  Package,
  Plug,
  Settings,
  Store,
  UserRound,
  Users,
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
 * Navegación agrupada por área de trabajo. Solo rutas reales:
 * no se listan secciones que todavía no existen.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operación",
    items: [
      { href: "/dashboard", label: "Resumen", icon: LayoutDashboard, exact: true },
      { href: "/dashboard/conversaciones", label: "Conversaciones", icon: Inbox },
      { href: "/dashboard/turnos", label: "Turnos", icon: CalendarClock },
    ],
  },
  {
    label: "Agente IA",
    items: [
      { href: "/dashboard/agente", label: "Agente", icon: Bot },
      { href: "/dashboard/conocimiento", label: "Conocimiento", icon: BookOpen },
    ],
  },
  {
    label: "Negocio",
    items: [
      { href: "/dashboard/negocio", label: "Información", icon: Store },
      { href: "/dashboard/productos", label: "Productos", icon: Package },
      { href: "/dashboard/servicios", label: "Servicios", icon: Briefcase },
      {
        href: "/dashboard/preguntas",
        label: "Preguntas frecuentes",
        icon: MessageCircleQuestion,
      },
    ],
  },
  {
    label: "Automatización",
    items: [
      {
        href: "/dashboard/automatizaciones",
        label: "Automatizaciones",
        icon: Workflow,
      },
      { href: "/dashboard/integraciones", label: "Integraciones", icon: Plug },
    ],
  },
  {
    label: "Análisis",
    items: [{ href: "/dashboard/metricas", label: "Métricas", icon: BarChart3 }],
  },
  {
    label: "Administración",
    items: [
      { href: "/dashboard/equipo", label: "Equipo", icon: Users },
      { href: "/dashboard/configuracion", label: "Configuración", icon: Settings },
    ],
  },
  {
    label: "Cuenta",
    items: [
      { href: "/dashboard/perfil", label: "Perfil", icon: UserRound },
      { href: "/dashboard/planes", label: "Planes", icon: CreditCard },
      { href: "/dashboard/ayuda", label: "Centro de ayuda", icon: CircleHelp },
    ],
  },
];

/** Lista plana para breadcrumbs y búsqueda de sección activa. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
