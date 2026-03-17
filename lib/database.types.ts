export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      clientes: {
        Row: {
          activo: boolean
          created_at: string
          credito_apertura_pdf_path: string | null
          credito_apertura_updated_at: string | null
          direccion: string
          empresa_id: number
          id: number
          licencia_sanitaria_pdf_path: string | null
          licencia_sanitaria_updated_at: string | null
          nit: string | null
          nombre: string
          patente_comercio_pdf_path: string | null
          patente_comercio_updated_at: string | null
          telefono: string
          vendedor_id: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          credito_apertura_pdf_path?: string | null
          credito_apertura_updated_at?: string | null
          direccion: string
          empresa_id: number
          id?: never
          licencia_sanitaria_pdf_path?: string | null
          licencia_sanitaria_updated_at?: string | null
          nit?: string | null
          nombre: string
          patente_comercio_pdf_path?: string | null
          patente_comercio_updated_at?: string | null
          telefono: string
          vendedor_id?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          credito_apertura_pdf_path?: string | null
          credito_apertura_updated_at?: string | null
          direccion?: string
          empresa_id?: number
          id?: never
          licencia_sanitaria_pdf_path?: string | null
          licencia_sanitaria_updated_at?: string | null
          nit?: string | null
          nombre?: string
          patente_comercio_pdf_path?: string | null
          patente_comercio_updated_at?: string | null
          telefono?: string
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compras: {
        Row: {
          comentarios: string | null
          created_at: string
          empresa_id: number
          estado: string
          fecha: string
          fecha_vencimiento: string | null
          id: number
          monto_total: number | null
          numero_factura: string | null
          proveedor: string | null
          proveedor_id: number
          saldo_pendiente: number | null
          tipo_pago: string
        }
        Insert: {
          comentarios?: string | null
          created_at?: string
          empresa_id: number
          estado?: string
          fecha?: string
          fecha_vencimiento?: string | null
          id?: never
          monto_total?: number | null
          numero_factura?: string | null
          proveedor?: string | null
          proveedor_id: number
          saldo_pendiente?: number | null
          tipo_pago?: string
        }
        Update: {
          comentarios?: string | null
          created_at?: string
          empresa_id?: number
          estado?: string
          fecha?: string
          fecha_vencimiento?: string | null
          id?: never
          monto_total?: number | null
          numero_factura?: string | null
          proveedor?: string | null
          proveedor_id?: number
          saldo_pendiente?: number | null
          tipo_pago?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_detalle: {
        Row: {
          cantidad: number
          compra_id: number
          empresa_id: number
          id: number
          image_path: string | null
          lote_id: number
          precio_compra_unit: number
          producto_id: number
          subtotal: number | null
        }
        Insert: {
          cantidad: number
          compra_id: number
          empresa_id: number
          id?: never
          image_path?: string | null
          lote_id: number
          precio_compra_unit: number
          producto_id: number
          subtotal?: number | null
        }
        Update: {
          cantidad?: number
          compra_id?: number
          empresa_id?: number
          id?: never
          image_path?: string | null
          lote_id?: number
          precio_compra_unit?: number
          producto_id?: number
          subtotal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_detalle_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_detalle_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "producto_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "compras_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "compras_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "compras_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["producto_id"]
          },
        ]
      }
      compras_pagos: {
        Row: {
          comentario: string | null
          compra_id: number
          comprobante_path: string | null
          created_by: string | null
          empresa_id: number
          fecha: string
          id: number
          metodo: string | null
          monto: number
          referencia: string | null
        }
        Insert: {
          comentario?: string | null
          compra_id: number
          comprobante_path?: string | null
          created_by?: string | null
          empresa_id: number
          fecha?: string
          id?: never
          metodo?: string | null
          monto: number
          referencia?: string | null
        }
        Update: {
          comentario?: string | null
          compra_id?: number
          comprobante_path?: string | null
          created_by?: string | null
          empresa_id?: number
          fecha?: string
          id?: never
          metodo?: string | null
          monto?: number
          referencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_pagos_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_pagos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      devoluciones: {
        Row: {
          created_by: string
          empresa_id: number
          fecha: string
          id: number
          motivo: string | null
          venta_id: number
        }
        Insert: {
          created_by?: string
          empresa_id: number
          fecha?: string
          id?: never
          motivo?: string | null
          venta_id: number
        }
        Update: {
          created_by?: string
          empresa_id?: number
          fecha?: string
          id?: never
          motivo?: string | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "devoluciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      devoluciones_detalle: {
        Row: {
          cantidad: number
          devolucion_id: number
          empresa_id: number
          id: number
          lote_id: number
          producto_id: number
        }
        Insert: {
          cantidad: number
          devolucion_id: number
          empresa_id: number
          id?: never
          lote_id: number
          producto_id: number
        }
        Update: {
          cantidad?: number
          devolucion_id?: number
          empresa_id?: number
          id?: never
          lote_id?: number
          producto_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "devoluciones_detalle_devolucion_id_fkey"
            columns: ["devolucion_id"]
            isOneToOne: false
            referencedRelation: "devoluciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "producto_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "devoluciones_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["producto_id"]
          },
        ]
      }
      empresa_usuarios: {
        Row: {
          created_at: string
          empresa_id: number
          es_propietario: boolean
          estado: string
          id: number
          rol_empresa: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: number
          es_propietario?: boolean
          estado?: string
          id?: never
          rol_empresa: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: number
          es_propietario?: boolean
          estado?: string
          id?: never
          rol_empresa?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_usuarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          created_at: string
          created_by: string | null
          estado: string
          id: number
          nombre: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: never
          nombre: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: never
          nombre?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      marcas: {
        Row: {
          activo: boolean
          created_at: string
          empresa_id: number
          id: number
          nombre: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          empresa_id: number
          id?: number
          nombre: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          empresa_id?: number
          id?: number
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "marcas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      notif_outbox: {
        Row: {
          attempts: number
          created_at: string
          empresa_id: number
          id: number
          last_error: string | null
          payload: Json
          processed_at: string | null
          type: string
          venta_id: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          empresa_id: number
          id?: number
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          type: string
          venta_id: number
        }
        Update: {
          attempts?: number
          created_at?: string
          empresa_id?: number
          id?: number
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          type?: string
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "notif_outbox_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      notif_stock_state: {
        Row: {
          empresa_id: number
          is_low: boolean
          last_stock: number
          producto_id: number
          updated_at: string
        }
        Insert: {
          empresa_id: number
          is_low?: boolean
          last_stock?: number
          producto_id: number
          updated_at?: string
        }
        Update: {
          empresa_id?: number
          is_low?: boolean
          last_stock?: number
          producto_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notif_stock_state_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notif_stock_state_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notif_stock_state_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notif_stock_state_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notif_stock_state_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notif_stock_state_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "notif_stock_state_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["producto_id"]
          },
        ]
      }
      producto_lotes: {
        Row: {
          activo: boolean
          empresa_id: number
          fecha_exp: string | null
          id: number
          lote: string
          producto_id: number
        }
        Insert: {
          activo?: boolean
          empresa_id: number
          fecha_exp?: string | null
          id?: never
          lote: string
          producto_id: number
        }
        Update: {
          activo?: boolean
          empresa_id?: number
          fecha_exp?: string | null
          id?: never
          lote?: string
          producto_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "producto_lotes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_lotes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_lotes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_lotes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_lotes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_lotes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "producto_lotes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["producto_id"]
          },
        ]
      }
      producto_precio_override: {
        Row: {
          empresa_id: number
          motivo: string | null
          precio_compra_override: number
          producto_id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          empresa_id: number
          motivo?: string | null
          precio_compra_override: number
          producto_id: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          empresa_id?: number
          motivo?: string | null
          precio_compra_override?: number
          producto_id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producto_precio_override_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_precio_override_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_precio_override_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_precio_override_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_precio_override_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_precio_override_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "producto_precio_override_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["producto_id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          empresa_id: number
          id: number
          image_path: string | null
          marca_id: number | null
          nombre: string
          requiere_receta: boolean
          tiene_iva: boolean
        }
        Insert: {
          activo?: boolean
          empresa_id: number
          id?: never
          image_path?: string | null
          marca_id?: number | null
          nombre: string
          requiere_receta?: boolean
          tiene_iva?: boolean
        }
        Update: {
          activo?: boolean
          empresa_id?: number
          id?: never
          image_path?: string | null
          marca_id?: number | null
          nombre?: string
          requiere_receta?: boolean
          tiene_iva?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "marcas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          codigo: string | null
          created_at: string
          full_name: string | null
          id: string
          role: string
        }
        Insert: {
          codigo?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          role?: string
        }
        Update: {
          codigo?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      proveedores: {
        Row: {
          activo: boolean
          created_at: string
          direccion: string | null
          empresa_id: number
          id: number
          nit: string | null
          nombre: string
          telefono: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          direccion?: string | null
          empresa_id: number
          id?: never
          nit?: string | null
          nombre: string
          telefono?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          direccion?: string | null
          empresa_id?: number
          id?: never
          nit?: string | null
          nombre?: string
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lotes: {
        Row: {
          empresa_id: number
          lote_id: number
          stock_reservado: number
          stock_total: number
        }
        Insert: {
          empresa_id: number
          lote_id: number
          stock_reservado?: number
          stock_total?: number
        }
        Update: {
          empresa_id?: number
          lote_id?: number
          stock_reservado?: number
          stock_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_lotes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lotes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: true
            referencedRelation: "producto_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lotes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: true
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "stock_lotes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: true
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["lote_id"]
          },
        ]
      }
      timezone_names_cache: {
        Row: {
          name: string
        }
        Insert: {
          name: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      user_push_tokens: {
        Row: {
          created_at: string
          device_id: string | null
          enabled: boolean
          expo_token: string
          id: number
          platform: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          enabled?: boolean
          expo_token: string
          id?: number
          platform?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          enabled?: boolean
          expo_token?: string
          id?: number
          platform?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ventas: {
        Row: {
          anulado_at: string | null
          cancel_reason: string | null
          canceled_at: string | null
          cliente_id: number
          cliente_nombre: string | null
          comentarios: string | null
          created_at: string
          empresa_id: number
          estado: string
          factura_1_cargada: boolean
          factura_2_cargada: boolean
          fecha: string
          id: number
          receta_cargada: boolean
          refactura_de_id: number | null
          refacturada_por_id: number | null
          requiere_receta: boolean
          vendedor_codigo: string | null
          vendedor_id: string | null
        }
        Insert: {
          anulado_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          cliente_id: number
          cliente_nombre?: string | null
          comentarios?: string | null
          created_at?: string
          empresa_id: number
          estado?: string
          factura_1_cargada?: boolean
          factura_2_cargada?: boolean
          fecha?: string
          id?: never
          receta_cargada?: boolean
          refactura_de_id?: number | null
          refacturada_por_id?: number | null
          requiere_receta?: boolean
          vendedor_codigo?: string | null
          vendedor_id?: string | null
        }
        Update: {
          anulado_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          cliente_id?: number
          cliente_nombre?: string | null
          comentarios?: string | null
          created_at?: string
          empresa_id?: number
          estado?: string
          factura_1_cargada?: boolean
          factura_2_cargada?: boolean
          fecha?: string
          id?: never
          receta_cargada?: boolean
          refactura_de_id?: number | null
          refacturada_por_id?: number | null
          requiere_receta?: boolean
          vendedor_codigo?: string | null
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_detalle: {
        Row: {
          cantidad: number
          empresa_id: number
          id: number
          lote_id: number
          precio_venta_unit: number
          producto_id: number
          subtotal: number | null
          venta_id: number
        }
        Insert: {
          cantidad: number
          empresa_id: number
          id?: never
          lote_id: number
          precio_venta_unit: number
          producto_id: number
          subtotal?: number | null
          venta_id: number
        }
        Update: {
          cantidad?: number
          empresa_id?: number
          id?: never
          lote_id?: number
          precio_venta_unit?: number
          producto_id?: number
          subtotal?: number | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_detalle_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "producto_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "ventas_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_devoluciones: {
        Row: {
          creado_en: string
          creado_por: string | null
          empresa_id: number
          id: number
          motivo: string | null
          venta_id: number
        }
        Insert: {
          creado_en?: string
          creado_por?: string | null
          empresa_id: number
          id?: number
          motivo?: string | null
          venta_id: number
        }
        Update: {
          creado_en?: string
          creado_por?: string | null
          empresa_id?: number
          id?: number
          motivo?: string | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_devoluciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_devoluciones_detalle: {
        Row: {
          cantidad: number
          devolucion_id: number
          empresa_id: number
          id: number
          lote_id: number
        }
        Insert: {
          cantidad: number
          devolucion_id: number
          empresa_id: number
          id?: number
          lote_id: number
        }
        Update: {
          cantidad?: number
          devolucion_id?: number
          empresa_id?: number
          id?: number
          lote_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_devoluciones_detalle_devolucion_id_fkey"
            columns: ["devolucion_id"]
            isOneToOne: false
            referencedRelation: "ventas_devoluciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_detalle_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "producto_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["lote_id"]
          },
          {
            foreignKeyName: "ventas_devoluciones_detalle_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["lote_id"]
          },
        ]
      }
      ventas_eventos: {
        Row: {
          a_estado: string | null
          creado_en: string
          creado_por: string | null
          de_estado: string | null
          empresa_id: number
          id: number
          nota: string | null
          tipo: string
          venta_id: number
        }
        Insert: {
          a_estado?: string | null
          creado_en?: string
          creado_por?: string | null
          de_estado?: string | null
          empresa_id: number
          id?: number
          nota?: string | null
          tipo: string
          venta_id: number
        }
        Update: {
          a_estado?: string | null
          creado_en?: string
          creado_por?: string | null
          de_estado?: string | null
          empresa_id?: number
          id?: number
          nota?: string | null
          tipo?: string
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_eventos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_facturas: {
        Row: {
          created_at: string
          empresa_id: number
          fecha_emision: string | null
          fecha_vencimiento: string
          id: number
          monto_total: number
          numero_factura: string | null
          original_name: string | null
          path: string
          size_bytes: number | null
          tipo: string
          uploaded_by: string | null
          venta_id: number
        }
        Insert: {
          created_at?: string
          empresa_id: number
          fecha_emision?: string | null
          fecha_vencimiento: string
          id?: never
          monto_total: number
          numero_factura?: string | null
          original_name?: string | null
          path: string
          size_bytes?: number | null
          tipo: string
          uploaded_by?: string | null
          venta_id: number
        }
        Update: {
          created_at?: string
          empresa_id?: number
          fecha_emision?: string | null
          fecha_vencimiento?: string
          id?: never
          monto_total?: number
          numero_factura?: string | null
          original_name?: string | null
          path?: string
          size_bytes?: number | null
          tipo?: string
          uploaded_by?: string | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_facturas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_pagos: {
        Row: {
          comentario: string | null
          comprobante_path: string | null
          created_at: string
          created_by: string | null
          empresa_id: number
          factura_id: number | null
          fecha: string
          id: number
          metodo: string | null
          monto: number
          referencia: string | null
          venta_id: number
        }
        Insert: {
          comentario?: string | null
          comprobante_path?: string | null
          created_at?: string
          created_by?: string | null
          empresa_id: number
          factura_id?: number | null
          fecha?: string
          id?: number
          metodo?: string | null
          monto: number
          referencia?: string | null
          venta_id: number
        }
        Update: {
          comentario?: string | null
          comprobante_path?: string | null
          created_at?: string
          created_by?: string | null
          empresa_id?: number
          factura_id?: number | null
          fecha?: string
          id?: number
          metodo?: string | null
          monto?: number
          referencia?: string | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_pagos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_factura_fk"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "ventas_facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_pagos_reportados: {
        Row: {
          comentario: string | null
          comprobante_path: string | null
          created_at: string
          created_by: string
          empresa_id: number
          estado: string
          factura_id: number | null
          fecha_reportado: string
          id: number
          metodo: string | null
          monto: number
          nota_admin: string | null
          referencia: string | null
          revisado_at: string | null
          revisado_por: string | null
          venta_id: number
        }
        Insert: {
          comentario?: string | null
          comprobante_path?: string | null
          created_at?: string
          created_by?: string
          empresa_id: number
          estado?: string
          factura_id?: number | null
          fecha_reportado?: string
          id?: number
          metodo?: string | null
          monto: number
          nota_admin?: string | null
          referencia?: string | null
          revisado_at?: string | null
          revisado_por?: string | null
          venta_id: number
        }
        Update: {
          comentario?: string | null
          comprobante_path?: string | null
          created_at?: string
          created_by?: string
          empresa_id?: number
          estado?: string
          factura_id?: number | null
          fecha_reportado?: string
          id?: number
          metodo?: string | null
          monto?: number
          nota_admin?: string | null
          referencia?: string | null
          revisado_at?: string | null
          revisado_por?: string | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_pagos_reportados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "ventas_facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_pagos_reportados_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_permisos_edicion: {
        Row: {
          empresa_id: number
          expira_at: string
          id: number
          otorgado_a: string
          otorgado_at: string
          otorgado_por: string | null
          tipo: string
          used_at: string | null
          venta_id: number
        }
        Insert: {
          empresa_id: number
          expira_at: string
          id?: number
          otorgado_a: string
          otorgado_at?: string
          otorgado_por?: string | null
          tipo: string
          used_at?: string | null
          venta_id: number
        }
        Update: {
          empresa_id?: number
          expira_at?: string
          id?: number
          otorgado_a?: string
          otorgado_at?: string
          otorgado_por?: string | null
          tipo?: string
          used_at?: string | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_permisos_edicion_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_permisos_edicion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_recetas: {
        Row: {
          created_at: string
          empresa_id: number
          id: number
          path: string
          uploaded_by: string | null
          venta_id: number
        }
        Insert: {
          created_at?: string
          empresa_id: number
          id?: never
          path: string
          uploaded_by?: string | null
          venta_id: number
        }
        Update: {
          created_at?: string
          empresa_id?: number
          id?: never
          path?: string
          uploaded_by?: string | null
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_recetas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_recetas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      ventas_tags: {
        Row: {
          created_at: string
          created_by: string | null
          empresa_id: number
          id: number
          nota: string | null
          removed_at: string | null
          removed_by: string | null
          tag: string
          venta_id: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empresa_id: number
          id?: number
          nota?: string | null
          removed_at?: string | null
          removed_by?: string | null
          tag: string
          venta_id: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empresa_id?: number
          id?: number
          nota?: string | null
          removed_at?: string | null
          removed_by?: string | null
          tag?: string
          venta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_tags_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
    }
    Views: {
      vw_cxc_ventas: {
        Row: {
          cliente_id: number | null
          cliente_nombre: string | null
          empresa_id: number | null
          facturas: string[] | null
          fecha: string | null
          fecha_primer_pago: string | null
          fecha_ultimo_pago: string | null
          fecha_vencimiento: string | null
          pagado: number | null
          saldo: number | null
          total: number | null
          vendedor_codigo: string | null
          vendedor_id: string | null
          venta_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_inventario_productos: {
        Row: {
          activo: boolean | null
          empresa_id: number | null
          fecha_exp_proxima: string | null
          id: number | null
          image_path: string | null
          lote_proximo: string | null
          marca: string | null
          marca_id: number | null
          marca_nombre: string | null
          nombre: string | null
          precio_min_venta: number | null
          stock_disponible: number | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "marcas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_inventario_productos_base: {
        Row: {
          activo: boolean | null
          empresa_id: number | null
          fecha_exp_proxima: string | null
          id: number | null
          image_path: string | null
          lote_proximo: string | null
          marca_id: number | null
          marca_nombre: string | null
          nombre: string | null
          precio_min_venta: number | null
          stock_disponible: number | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "marcas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_inventario_productos_v2: {
        Row: {
          activo: boolean | null
          empresa_id: number | null
          fecha_exp_proxima: string | null
          id: number | null
          image_path: string | null
          lote_proximo: string | null
          marca: string | null
          marca_id: number | null
          marca_nombre: string | null
          nombre: string | null
          precio_min_venta: number | null
          requiere_receta: boolean | null
          stock_disponible: number | null
          tiene_iva: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "marcas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_producto_lotes_detalle: {
        Row: {
          activo: boolean | null
          empresa_id: number | null
          fecha_exp: string | null
          image_path: string | null
          lote: string | null
          lote_id: number | null
          marca: string | null
          nombre: string | null
          precio_compra_actual: number | null
          precio_min_venta: number | null
          producto_id: number | null
          requiere_receta: boolean | null
          stock_disponible_lote: number | null
          stock_reservado_lote: number | null
          stock_total_lote: number | null
          tiene_iva: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_producto_lotes_detalle_base: {
        Row: {
          activo: boolean | null
          empresa_id: number | null
          fecha_exp: string | null
          image_path: string | null
          lote: string | null
          lote_id: number | null
          marca: string | null
          nombre: string | null
          precio_compra_actual: number | null
          precio_min_venta: number | null
          producto_id: number | null
          requiere_receta: boolean | null
          stock_disponible_lote: number | null
          stock_reservado_lote: number | null
          stock_total_lote: number | null
          tiene_iva: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_reporte_utilidad_productos: {
        Row: {
          costo_total: number | null
          empresa_id: number | null
          marca_id: number | null
          marca_nombre: string | null
          margen: number | null
          producto_id: number | null
          producto_nombre: string | null
          total_ventas: number | null
          unidades_vendidas: number | null
          utilidad_bruta: number | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "marcas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_inventario_productos_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle"
            referencedColumns: ["producto_id"]
          },
          {
            foreignKeyName: "ventas_detalle_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "vw_producto_lotes_detalle_base"
            referencedColumns: ["producto_id"]
          },
        ]
      }
      vw_reporte_utilidad_ventas: {
        Row: {
          cliente_nombre: string | null
          costo_total: number | null
          empresa_id: number | null
          fecha_venta: string | null
          margen: number | null
          total_venta: number | null
          utilidad_bruta: number | null
          vendedor_id: string | null
          venta_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_vendedores_lista: {
        Row: {
          empresa_id: number | null
          vendedor_codigo: string | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_venta_devolucion_resumen: {
        Row: {
          empresa_id: number | null
          estado: string | null
          total_devuelto: number | null
          total_vendido: number | null
          venta_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_venta_razon_anulacion: {
        Row: {
          empresa_id: number | null
          solicitud_fecha: string | null
          solicitud_nota: string | null
          solicitud_user_id: string | null
          venta_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_tags_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_tags_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      vw_ventas_estado_efectivo: {
        Row: {
          anulado_at: string | null
          cancel_reason: string | null
          canceled_at: string | null
          cliente_id: number | null
          cliente_nombre: string | null
          comentarios: string | null
          created_at: string | null
          empresa_id: number | null
          estado: string | null
          estado_efectivo: string | null
          factura_1_cargada: boolean | null
          factura_2_cargada: boolean | null
          fecha: string | null
          id: number | null
          receta_cargada: boolean | null
          refactura_de_id: number | null
          refacturada_por_id: number | null
          requiere_receta: boolean | null
          tiene_evento_entregado: boolean | null
          tiene_tag_anulado: boolean | null
          vendedor_codigo: string | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refactura_de_id_fkey"
            columns: ["refactura_de_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_reporte_utilidad_ventas"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_venta_devolucion_resumen"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_estado_efectivo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_facturacion_pendientes"
            referencedColumns: ["venta_id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_lista"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_refacturada_por_id_fkey"
            columns: ["refacturada_por_id"]
            isOneToOne: false
            referencedRelation: "vw_ventas_solicitudes_pendientes_admin"
            referencedColumns: ["venta_id"]
          },
        ]
      }
      vw_ventas_facturacion_pendientes: {
        Row: {
          accion_at: string | null
          accion_nota: string | null
          accion_tag: string | null
          cliente_id: number | null
          cliente_nombre: string | null
          comentarios: string | null
          empresa_id: number | null
          estado: string | null
          fecha: string | null
          vendedor_id: string | null
          venta_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_ventas_lista: {
        Row: {
          cliente_id: number | null
          cliente_nombre: string | null
          empresa_id: number | null
          estado: string | null
          estado_devolucion: string | null
          factura_1_cargada: boolean | null
          factura_2_cargada: boolean | null
          fecha: string | null
          id: number | null
          receta_cargada: boolean | null
          requiere_receta: boolean | null
          total_devuelto: number | null
          total_items: number | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_ventas_pagos_log: {
        Row: {
          action: string | null
          actor_nombre: string | null
          cliente_nombre: string | null
          comentario: string | null
          empresa_id: number | null
          factura_numero: string | null
          metodo: string | null
          monto: number | null
          referencia: string | null
          registrado: string | null
        }
        Relationships: []
      }
      vw_ventas_solicitudes_pendientes_admin: {
        Row: {
          cliente_id: number | null
          cliente_nombre: string | null
          empresa_id: number | null
          estado: string | null
          fecha: string | null
          solicitud_accion: string | null
          solicitud_at: string | null
          solicitud_by: string | null
          solicitud_nota: string | null
          solicitud_tag: string | null
          vendedor_id: string | null
          venta_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_cxc_ventas"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _test_get_stock_total: { Args: { p_lote_id: number }; Returns: number }
      anular_venta: {
        Args: { p_motivo: string; p_venta_id: number }
        Returns: undefined
      }
      crear_devolucion: {
        Args: {
          p_created_by: string
          p_items: Json
          p_motivo: string
          p_venta_id: number
        }
        Returns: number
      }
      create_venta_nueva:
        | {
            Args: {
              p_cliente_nombre: string
              p_comentarios: string
              p_items: Json
            }
            Returns: number
          }
        | {
            Args: {
              p_cliente_nombre: string
              p_comentarios: string
              p_items: Json
              p_vendedor_id: string
            }
            Returns: number
          }
      current_role: { Args: never; Returns: string }
      enviar_a_ruta: { Args: { p_venta_id: number }; Returns: undefined }
      facturar_venta:
        | { Args: { p_venta_id: number }; Returns: undefined }
        | {
            Args: {
              p_ignorar_facturas?: boolean
              p_ignorar_receta?: boolean
              p_venta_id: number
            }
            Returns: undefined
          }
      has_role: { Args: { p_role: string }; Returns: boolean }
      has_role_empresa: {
        Args: { p_empresa_id: number; p_role: string }
        Returns: boolean
      }
      marcar_entregado: { Args: { p_venta_id: number }; Returns: undefined }
      recalc_saldo_compra: { Args: { p_compra_id: number }; Returns: undefined }
      recalc_total_compra:
        | { Args: { p_compra_id: number }; Returns: undefined }
        | {
            Args: { p_compra_id: number; p_empresa_id: number }
            Returns: undefined
          }
      registrar_devolucion_venta_por_detalle: {
        Args: { p_items: Json; p_motivo: string; p_venta_id: number }
        Returns: number
      }
      reserve_stock_fefo: {
        Args: { p_cantidad: number; p_producto_id: number }
        Returns: number
      }
      rpc_admin_otorgar_edicion_pago: {
        Args: { p_horas?: number; p_otorgado_a: string; p_venta_id: number }
        Returns: undefined
      }
      rpc_admin_resolver_solicitud: {
        Args: { p_decision: string; p_venta_id: number }
        Returns: Json
      }
      rpc_calc_stock_disponible_producto:
        | {
            Args: { p_empresa_id: number; p_producto_id: number }
            Returns: number
          }
        | { Args: { p_producto_id: number }; Returns: number }
      rpc_claim_push_token: {
        Args: {
          p_device_id: string
          p_expo_token: string
          p_platform?: string
          p_user_id: string
        }
        Returns: undefined
      }
      rpc_comisiones_resumen_mes:
        | {
            Args: {
              p_comision_pct?: number
              p_desde: string
              p_hasta: string
              p_iva_pct?: number
              p_vendedor_id?: string
            }
            Returns: {
              comision_mes: number
              total_con_iva: number
              total_sin_iva: number
              vendedor_codigo: string
              vendedor_id: string
            }[]
          }
        | {
            Args: {
              p_comision_pct?: number
              p_desde: string
              p_empresa_id: number
              p_hasta: string
              p_iva_pct?: number
              p_vendedor_id?: string
            }
            Returns: {
              comision_mes: number
              total_con_iva: number
              total_sin_iva: number
              vendedor_codigo: string
              vendedor_id: string
            }[]
          }
      rpc_comisiones_ventas_liquidadas:
        | {
            Args: {
              p_cliente_id?: number
              p_desde: string
              p_hasta: string
              p_vendedor_id?: string
            }
            Returns: {
              cliente_id: number
              cliente_nombre: string
              facturas: string[]
              fecha_liquidacion: string
              fecha_venta: string
              pagado: number
              saldo: number
              total: number
              vendedor_codigo: string
              vendedor_id: string
              venta_id: number
            }[]
          }
        | {
            Args: {
              p_cliente_id?: number
              p_comision_pct?: number
              p_desde: string
              p_hasta: string
              p_iva_pct?: number
              p_vendedor_id?: string
            }
            Returns: {
              cliente_id: number
              cliente_nombre: string
              comision_monto: number
              facturas: string[]
              fecha_liquidacion: string
              fecha_venta: string
              pagado: number
              saldo: number
              total_con_iva: number
              total_sin_iva: number
              vendedor_codigo: string
              vendedor_id: string
              venta_id: number
            }[]
          }
      rpc_compra_actualizar_linea: {
        Args: {
          p_detalle_id: number
          p_empresa_id: number
          p_nueva_cantidad: number
          p_nueva_fecha_exp: string
          p_nuevo_lote: string
          p_nuevo_precio: number
        }
        Returns: undefined
      }
      rpc_compra_agregar_linea: {
        Args: {
          p_cantidad: number
          p_compra_id: number
          p_empresa_id: number
          p_fecha_exp: string
          p_lote: string
          p_precio_compra_unit: number
          p_producto_id: number
        }
        Returns: undefined
      }
      rpc_compra_aplicar_pago:
        | {
            Args: {
              p_comentario?: string
              p_compra_id: number
              p_fecha?: string
              p_metodo?: string
              p_monto: number
              p_referencia?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_comentario?: string
              p_compra_id: number
              p_comprobante_path?: string
              p_fecha?: string
              p_metodo?: string
              p_monto: number
              p_referencia?: string
            }
            Returns: undefined
          }
      rpc_compra_eliminar_compra: {
        Args: { p_compra_id: number }
        Returns: undefined
      }
      rpc_compra_eliminar_linea:
        | { Args: { p_detalle_id: number }; Returns: undefined }
        | {
            Args: { p_detalle_id: number; p_empresa_id: number }
            Returns: undefined
          }
      rpc_compra_reemplazar:
        | {
            Args: { p_compra: Json; p_compra_id: number; p_detalles: Json }
            Returns: undefined
          }
        | {
            Args: {
              p_compra: Json
              p_compra_id: number
              p_detalles: Json
              p_empresa_id: number
            }
            Returns: undefined
          }
      rpc_crear_compra:
        | { Args: { p_compra: Json; p_detalles: Json }; Returns: number }
        | {
            Args: { p_compra: Json; p_detalles: Json; p_empresa_id: number }
            Returns: number
          }
      rpc_crear_venta: { Args: { p_items: Json; p_venta: Json }; Returns: Json }
      rpc_cxc_vendedores:
        | {
            Args: never
            Returns: {
              full_name: string
              id: string
              role: string
            }[]
          }
        | {
            Args: { p_empresa_id: number }
            Returns: {
              full_name: string
              id: string
              role: string
            }[]
          }
      rpc_cxc_ventas:
        | {
            Args: { p_empresa_id: number; p_vendedor_id?: string }
            Returns: {
              cliente_id: number | null
              cliente_nombre: string | null
              empresa_id: number | null
              facturas: string[] | null
              fecha: string | null
              fecha_primer_pago: string | null
              fecha_ultimo_pago: string | null
              fecha_vencimiento: string | null
              pagado: number | null
              saldo: number | null
              total: number | null
              vendedor_codigo: string | null
              vendedor_id: string | null
              venta_id: number | null
            }[]
            SetofOptions: {
              from: "*"
              to: "vw_cxc_ventas"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { p_vendedor_id?: string }
            Returns: {
              cliente_id: number | null
              cliente_nombre: string | null
              empresa_id: number | null
              facturas: string[] | null
              fecha: string | null
              fecha_primer_pago: string | null
              fecha_ultimo_pago: string | null
              fecha_vencimiento: string | null
              pagado: number | null
              saldo: number | null
              total: number | null
              vendedor_codigo: string | null
              vendedor_id: string | null
              venta_id: number | null
            }[]
            SetofOptions: {
              from: "*"
              to: "vw_cxc_ventas"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      rpc_dashboard_admin:
        | { Args: never; Returns: Json }
        | { Args: { p_empresa_id: number }; Returns: Json }
      rpc_dashboard_ventas:
        | {
            Args: { p_empresa_id: number; p_vendedor_id: string }
            Returns: Json
          }
        | { Args: { p_vendedor_id: string }; Returns: Json }
      rpc_enqueue_stock_bajo_20:
        | {
            Args: { p_empresa_id: number; p_producto_id: number }
            Returns: undefined
          }
        | { Args: { p_producto_id: number }; Returns: undefined }
      rpc_estado_cuenta_cliente_pdf:
        | { Args: { p_cliente_id: number }; Returns: Json }
        | {
            Args: { p_cliente_id: number; p_empresa_id: number }
            Returns: Json
          }
      rpc_inventario_buscar:
        | {
            Args: {
              p_empresa_id: number
              p_limit?: number
              p_offset?: number
              p_q: string
            }
            Returns: {
              activo: boolean
              fecha_exp_proxima: string
              id: number
              lote_proximo: string
              marca: string
              nombre: string
              precio_compra_actual: number
              precio_min_venta: number
              stock_disponible: number
            }[]
          }
        | {
            Args: { p_limit?: number; p_offset?: number; p_q: string }
            Returns: {
              activo: boolean
              fecha_exp_proxima: string
              id: number
              lote_proximo: string
              marca: string
              nombre: string
              precio_compra_actual: number
              precio_min_venta: number
              stock_disponible: number
            }[]
          }
      rpc_inventario_totales_simple:
        | {
            Args: { p_empresa_id: number; p_producto_id: number }
            Returns: {
              entradas: number
              saldo: number
              salidas: number
            }[]
          }
        | {
            Args: { p_producto_id: number }
            Returns: {
              entradas: number
              saldo: number
              salidas: number
            }[]
          }
      rpc_inventario_totales_simple_v2:
        | {
            Args: { p_empresa_id: number; p_producto_id: number }
            Returns: {
              entradas: number
              reservado: number
              saldo: number
              salidas: number
            }[]
          }
        | {
            Args: { p_producto_id: number }
            Returns: {
              entradas: number
              reservado: number
              saldo: number
              salidas: number
            }[]
          }
      rpc_kardex_producto_detallado:
        | {
            Args: {
              p_desde: string
              p_empresa_id: number
              p_hasta: string
              p_producto_id: number
            }
            Returns: {
              cliente: string
              compra_id: number
              entrada: number
              estado: string
              factura_numero: string
              fecha: string
              lote: string
              lote_id: number
              proveedor: string
              saldo: number
              salida: number
              tipo: string
              venta_id: number
            }[]
          }
        | {
            Args: { p_desde: string; p_hasta: string; p_producto_id: number }
            Returns: {
              cliente: string
              compra_id: number
              entrada: number
              estado: string
              factura_numero: string
              fecha: string
              lote: string
              lote_id: number
              proveedor: string
              saldo: number
              salida: number
              tipo: string
              venta_id: number
            }[]
          }
      rpc_kardex_producto_detallado_audit: {
        Args: { p_desde: string; p_hasta: string; p_producto_id: number }
        Returns: {
          cliente: string
          compra_id: number
          entrada: number
          estado: string
          factura_numero: string
          fecha: string
          lote: string
          lote_id: number
          proveedor: string
          saldo_raw: number
          salida: number
          tipo: string
          venta_id: number
        }[]
      }
      rpc_notif_destinatarios_compra_linea_ingresada:
        | {
            Args: never
            Returns: {
              role: string
              user_id: string
            }[]
          }
        | {
            Args: { p_empresa_id: number }
            Returns: {
              role: string
              user_id: string
            }[]
          }
      rpc_notif_destinatarios_venta_facturada:
        | {
            Args: { p_empresa_id: number; p_venta_id: number }
            Returns: {
              role: string
              user_id: string
            }[]
          }
        | {
            Args: { p_venta_id: number }
            Returns: {
              role: string
              user_id: string
            }[]
          }
      rpc_notif_destinatarios_venta_nuevos:
        | {
            Args: never
            Returns: {
              role: string
              user_id: string
            }[]
          }
        | {
            Args: { p_empresa_id: number }
            Returns: {
              role: string
              user_id: string
            }[]
          }
      rpc_notif_outbox_claim:
        | {
            Args: { p_empresa_id: number; p_limit?: number }
            Returns: {
              attempts: number
              created_at: string
              empresa_id: number
              id: number
              last_error: string | null
              payload: Json
              processed_at: string | null
              type: string
              venta_id: number
            }[]
            SetofOptions: {
              from: "*"
              to: "notif_outbox"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { p_limit?: number }
            Returns: {
              attempts: number
              created_at: string
              empresa_id: number
              id: number
              last_error: string | null
              payload: Json
              processed_at: string | null
              type: string
              venta_id: number
            }[]
            SetofOptions: {
              from: "*"
              to: "notif_outbox"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      rpc_notif_outbox_mark_error: {
        Args: { p_error: string; p_id: number }
        Returns: undefined
      }
      rpc_notif_outbox_mark_processed: {
        Args: { p_id: number }
        Returns: undefined
      }
      rpc_producto_detalle:
        | {
            Args: { p_empresa_id: number; p_producto_id: number }
            Returns: Json
          }
        | { Args: { p_producto_id: number }; Returns: Json }
      rpc_report_compras_mensual_12m:
        | {
            Args: {
              p_empresa_id: number
              p_end_date?: string
              p_months?: number
              p_proveedor_id?: number
            }
            Returns: {
              compras_count: number
              mes: string
              saldo_pendiente: number
              saldo_vencido: number
              total_comprado: number
              vencidas_count: number
            }[]
          }
        | {
            Args: {
              p_end_date?: string
              p_months?: number
              p_proveedor_id?: number
            }
            Returns: {
              compras_count: number
              mes: string
              saldo_pendiente: number
              saldo_vencido: number
              total_comprado: number
              vencidas_count: number
            }[]
          }
      rpc_report_inventario_alertas:
        | {
            Args: {
              p_empresa_id: number
              p_exp_dias?: number
              p_incluir_inactivos?: boolean
              p_stock_bajo?: number
            }
            Returns: {
              fecha_exp: string
              lote: string
              lote_id: number
              marca: string
              producto: string
              producto_id: number
              stock_disponible: number
              stock_disponible_lote: number
              tipo: string
            }[]
          }
        | {
            Args: {
              p_exp_dias?: number
              p_incluir_inactivos?: boolean
              p_stock_bajo?: number
            }
            Returns: {
              fecha_exp: string
              lote: string
              lote_id: number
              marca: string
              producto: string
              producto_id: number
              stock_disponible: number
              stock_disponible_lote: number
              tipo: string
            }[]
          }
      rpc_report_kardex_producto_consolidado: {
        Args: {
          p_desde?: string
          p_hasta?: string
          p_incluir_anuladas?: boolean
          p_producto_id: number
        }
        Returns: {
          compra_id: number
          devolucion_id: number
          entrada: number
          fecha: string
          lote: string
          lote_id: number
          precio_unit: number
          ref_id: number
          saldo_producto: number
          salida: number
          subtotal: number
          tipo: string
          venta_id: number
        }[]
      }
      rpc_report_pagos_proveedores_mensual_12m:
        | {
            Args: {
              p_empresa_id: number
              p_end_date?: string
              p_months?: number
              p_proveedor_id?: number
            }
            Returns: {
              mes: string
              metodo: string
              monto: number
              pagos_count: number
            }[]
          }
        | {
            Args: {
              p_end_date?: string
              p_months?: number
              p_proveedor_id?: number
            }
            Returns: {
              mes: string
              metodo: string
              monto: number
              pagos_count: number
            }[]
          }
      rpc_report_producto_promedio_mensual_12m:
        | {
            Args: {
              p_empresa_id: number
              p_end_date?: string
              p_estado?: string
              p_months?: number
              p_producto_id: number
              p_vendedor_id?: string
            }
            Returns: {
              mes: string
              monto_mes: number
              precio_promedio_mes: number
              precio_promedio_periodo: number
              prom_monto_mes: number
              prom_unidades_mes: number
              unidades_mes: number
            }[]
          }
        | {
            Args: {
              p_end_date?: string
              p_estado?: string
              p_months?: number
              p_producto_id: number
              p_vendedor_id?: string
            }
            Returns: {
              mes: string
              monto_mes: number
              precio_promedio_mes: number
              precio_promedio_periodo: number
              prom_monto_mes: number
              prom_unidades_mes: number
              unidades_mes: number
            }[]
          }
      rpc_report_top_productos_12m:
        | {
            Args: {
              p_empresa_id: number
              p_end_date?: string
              p_estado?: string
              p_limit?: number
              p_months?: number
              p_order_by?: string
              p_vendedor_id?: string
            }
            Returns: {
              marca: string
              monto: number
              producto: string
              producto_id: number
              unidades: number
              ventas_count: number
            }[]
          }
        | {
            Args: {
              p_end_date?: string
              p_estado?: string
              p_limit?: number
              p_months?: number
              p_order_by?: string
              p_vendedor_id?: string
            }
            Returns: {
              marca: string
              monto: number
              producto: string
              producto_id: number
              unidades: number
              ventas_count: number
            }[]
          }
      rpc_report_ventas_mensual_12m:
        | {
            Args: {
              p_empresa_id: number
              p_end_date?: string
              p_estado?: string
              p_months?: number
              p_vendedor_id?: string
            }
            Returns: {
              mes: string
              monto: number
              unidades: number
              ventas_count: number
            }[]
          }
        | {
            Args: {
              p_end_date?: string
              p_estado?: string
              p_months?: number
              p_vendedor_id?: string
            }
            Returns: {
              mes: string
              monto: number
              unidades: number
              ventas_count: number
            }[]
          }
      rpc_reporte_bajo_movimiento:
        | {
            Args: { p_empresa_id: number; p_hasta: string; p_min_dias?: number }
            Returns: {
              dias_sin_movimiento: number
              marca_nombre: string
              producto_id: number
              producto_nombre: string
              stock_disponible: number
              ultima_venta: string
              ultimo_costo_unit: number
              valor_inventario: number
            }[]
          }
        | {
            Args: { p_hasta: string; p_min_dias?: number }
            Returns: {
              dias_sin_movimiento: number
              marca_nombre: string
              producto_id: number
              producto_nombre: string
              stock_disponible: number
              ultima_venta: string
              ultimo_costo_unit: number
              valor_inventario: number
            }[]
          }
      rpc_reporte_utilidad_global_v1:
        | {
            Args: { p_desde: string; p_hasta: string }
            Returns: {
              costo_total: number
              margen_pct: number
              total_ventas: number
              utilidad_bruta: number
            }[]
          }
        | {
            Args: { p_desde: string; p_empresa_id: number; p_hasta: string }
            Returns: {
              costo_total: number
              margen_pct: number
              total_ventas: number
              utilidad_bruta: number
            }[]
          }
      rpc_reporte_utilidad_productos: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          costo_total: number
          marca_id: number
          marca_nombre: string
          margen: number
          producto_id: number
          producto_nombre: string
          total_ventas: number
          unidades_vendidas: number
          utilidad_bruta: number
        }[]
      }
      rpc_reporte_utilidad_productos_v2: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          costo_prom: number
          costo_total: number
          marca_id: number
          marca_nombre: string
          margen: number
          margen_pct: number
          precio_venta_prom: number
          producto_id: number
          producto_nombre: string
          total_ventas: number
          unidades_vendidas: number
          utilidad_bruta: number
          utilidad_unit_prom: number
        }[]
      }
      rpc_reporte_utilidad_productos_v3:
        | {
            Args: { p_desde: string; p_hasta: string }
            Returns: {
              costo_total: number
              marca_id: number
              marca_nombre: string
              margen_pct: number
              participacion_utilidad_pct: number
              producto_id: number
              producto_nombre: string
              total_ventas: number
              unidades_vendidas: number
              utilidad_bruta: number
            }[]
          }
        | {
            Args: { p_desde: string; p_empresa_id: number; p_hasta: string }
            Returns: {
              costo_total: number
              marca_id: number
              marca_nombre: string
              margen_pct: number
              participacion_utilidad_pct: number
              producto_id: number
              producto_nombre: string
              total_ventas: number
              unidades_vendidas: number
              utilidad_bruta: number
            }[]
          }
      rpc_reporte_utilidad_resumen: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          costo_total: number
          margen: number
          margen_pct: number
          total_ventas: number
          unidades_vendidas: number
          utilidad_bruta: number
        }[]
      }
      rpc_require_admin: { Args: never; Returns: undefined }
      rpc_reservado_pendiente_producto:
        | {
            Args: { p_empresa_id: number; p_producto_id: number }
            Returns: number
          }
        | { Args: { p_producto_id: number }; Returns: number }
      rpc_venta_anular: {
        Args: { p_nota?: string; p_venta_id: number }
        Returns: undefined
      }
      rpc_venta_aplicar_pago:
        | {
            Args: {
              p_comentario: string
              p_comprobante_path: string
              p_factura_id: number
              p_metodo: string
              p_monto: number
              p_referencia: string
              p_venta_id: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_comentario?: string
              p_comprobante_path?: string
              p_fecha?: string
              p_metodo?: string
              p_monto: number
              p_referencia?: string
              p_venta_id: number
            }
            Returns: undefined
          }
      rpc_venta_aprobar_pago_reportado: {
        Args: { p_nota_admin?: string; p_pago_reportado_id: number }
        Returns: undefined
      }
      rpc_venta_borrar_receta: { Args: { p_receta_id: number }; Returns: Json }
      rpc_venta_delete_factura: {
        Args: { p_motivo?: string; p_numero: number; p_venta_id: number }
        Returns: undefined
      }
      rpc_venta_delete_receta: {
        Args: { p_motivo?: string; p_venta_id: number }
        Returns: undefined
      }
      rpc_venta_editar: {
        Args: { p_items: Json; p_venta: Json; p_venta_id: number }
        Returns: Json
      }
      rpc_venta_facturar: {
        Args: { p_facturas: Json; p_venta_id: number }
        Returns: Json
      }
      rpc_venta_marcar_entregada: {
        Args: { p_nota?: string; p_venta_id: number }
        Returns: Json
      }
      rpc_venta_pago_editar_meta: {
        Args: {
          p_comentario?: string
          p_comprobante_path?: string
          p_fecha?: string
          p_metodo?: string
          p_pago_id: number
          p_referencia?: string
        }
        Returns: undefined
      }
      rpc_venta_pago_editar_monto: {
        Args: { p_monto: number; p_pago_id: number }
        Returns: undefined
      }
      rpc_venta_pago_eliminar: {
        Args: { p_pago_id: number }
        Returns: undefined
      }
      rpc_venta_pasar_en_ruta: {
        Args: { p_nota?: string; p_venta_id: number }
        Returns: Json
      }
      rpc_venta_rechazar_pago_reportado: {
        Args: { p_nota_admin: string; p_pago_reportado_id: number }
        Returns: undefined
      }
      rpc_venta_registrar_receta: {
        Args: { p_path: string; p_venta_id: number }
        Returns: Json
      }
      rpc_venta_reportar_pago: {
        Args: {
          p_comentario: string
          p_comprobante_path: string
          p_factura_id: number
          p_metodo: string
          p_monto: number
          p_referencia: string
          p_venta_id: number
        }
        Returns: number
      }
      rpc_venta_set_en_ruta: {
        Args: { p_nota?: string; p_venta_id: number }
        Returns: undefined
      }
      rpc_venta_set_entregado: {
        Args: { p_nota?: string; p_venta_id: number }
        Returns: undefined
      }
      rpc_venta_set_factura: {
        Args: { p_numero: number; p_path: string; p_venta_id: number }
        Returns: undefined
      }
      rpc_venta_set_receta: {
        Args: { p_path: string; p_venta_id: number }
        Returns: undefined
      }
      rpc_ventas_dots:
        | { Args: { p_empresa_id: number; p_limit?: number }; Returns: Json }
        | { Args: { p_limit?: number }; Returns: Json }
      rpc_ventas_pagadas_en_rango:
        | {
            Args: {
              p_empresa_id: number
              p_from: string
              p_to: string
              p_vendedor_id?: string
            }
            Returns: {
              cliente_id: number
              cliente_nombre: string
              facturas: string[]
              fecha_pagada: string
              fecha_venta: string
              pagado: number
              saldo: number
              total: number
              vendedor_codigo: string
              vendedor_id: string
              venta_id: number
            }[]
          }
        | {
            Args: { p_from: string; p_to: string; p_vendedor_id?: string }
            Returns: {
              cliente_id: number
              cliente_nombre: string
              facturas: string[]
              fecha_pagada: string
              fecha_venta: string
              pagado: number
              saldo: number
              total: number
              vendedor_codigo: string
              vendedor_id: string
              venta_id: number
            }[]
          }
      rpc_ventas_receta_pendiente_por_mes:
        | {
            Args: { p_empresa_id: number; p_month: number; p_year: number }
            Returns: {
              cliente_id: number | null
              cliente_nombre: string | null
              empresa_id: number | null
              estado: string | null
              estado_devolucion: string | null
              factura_1_cargada: boolean | null
              factura_2_cargada: boolean | null
              fecha: string | null
              id: number | null
              receta_cargada: boolean | null
              requiere_receta: boolean | null
              total_devuelto: number | null
              total_items: number | null
              vendedor_id: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "vw_ventas_lista"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { p_month: number; p_year: number }
            Returns: {
              cliente_id: number | null
              cliente_nombre: string | null
              empresa_id: number | null
              estado: string | null
              estado_devolucion: string | null
              factura_1_cargada: boolean | null
              factura_2_cargada: boolean | null
              fecha: string | null
              id: number | null
              receta_cargada: boolean | null
              requiere_receta: boolean | null
              total_devuelto: number | null
              total_items: number | null
              vendedor_id: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "vw_ventas_lista"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      rpc_ventas_solicitar_accion: {
        Args: { p_accion: string; p_nota: string; p_venta_id: number }
        Returns: Json
      }
      tiene_membresia_activa: {
        Args: { p_empresa_id: number }
        Returns: boolean
      }
      venta_visible_en_nuevos:
        | {
            Args: { p_empresa_id: number; p_venta_id: number }
            Returns: boolean
          }
        | { Args: { p_venta_id: number }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
