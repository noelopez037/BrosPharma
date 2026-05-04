#!/usr/bin/env node
// Uso: node scripts/descargar-mes.js --mes YYYY-MM [--empresa-id 1] [--limite N]
// Ejemplo prueba: node scripts/descargar-mes.js --mes 2026-04 --limite 2
// Ejemplo completo: node scripts/descargar-mes.js --mes 2026-04

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const envPath = path.join(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    console.error("ERROR: No se encontró el archivo .env en la raíz del proyecto.");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

function sanitize(str) {
  return (str || "sin-nombre")
    .normalize("NFC")
    .replace(/[^a-zA-Z0-9\-_áéíóúÁÉÍÓÚüÜñÑ ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 35);
}

function askPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // Ocultar escritura en terminal
    const write = rl.output.write.bind(rl.output);
    rl.output.write = (s) => {
      if (s === prompt || s === "\r\n" || s === "\n") write(s);
    };
    rl.question(prompt, (answer) => {
      rl.output.write = write;
      rl.close();
      write("\n");
      resolve(answer);
    });
  });
}

async function downloadFile(supabase, storagePath, destPath) {
  const { data, error } = await supabase.storage
    .from("Ventas-Docs")
    .createSignedUrl(storagePath, 300);

  if (error || !data?.signedUrl) {
    console.warn(`    ⚠️  No se pudo obtener URL para: ${storagePath}`);
    return false;
  }

  const res = await fetch(data.signedUrl);
  if (!res.ok) {
    console.warn(`    ⚠️  Error al descargar (${res.status}): ${storagePath}`);
    return false;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return true;
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const mesArg = getArg(args, "--mes");
  const empresaIdArg = getArg(args, "--empresa-id");
  const limiteArg = getArg(args, "--limite");

  if (!mesArg || !/^\d{4}-\d{2}$/.test(mesArg)) {
    console.error("Uso: node scripts/descargar-mes.js --mes YYYY-MM [--empresa-id 1] [--limite N]");
    process.exit(1);
  }

  const empresaId = parseInt(empresaIdArg || "1");
  const limite = limiteArg ? parseInt(limiteArg) : null;

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error(
      "ERROR: Faltan variables en .env.\n" +
      "Asegúrate de tener EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });

  // Login con usuario
  console.log("\nIniciando sesión en BrosPharma...");
  const email = process.env.SUPABASE_USER_EMAIL || "noe@brospharma.com";
  const password = await askPassword(`Contraseña para ${email}: `);

  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
  if (loginError) {
    console.error("ERROR al iniciar sesión:", loginError.message);
    process.exit(1);
  }
  console.log("✓ Sesión iniciada.\n");

  const [año, mes] = mesArg.split("-").map(Number);
  const desde = new Date(año, mes - 1, 1).toISOString();
  const hasta = new Date(año, mes, 1).toISOString();

  console.log(`Buscando ventas con receta para ${mesArg} (empresa ${empresaId})...`);

  const { data: ventas, error } = await supabase
    .from("ventas")
    .select("id, cliente_nombre, fecha")
    .eq("empresa_id", empresaId)
    .eq("receta_cargada", true)
    .neq("estado", "ANULADO")
    .gte("fecha", desde)
    .lt("fecha", hasta)
    .order("fecha", { ascending: true });

  if (error) {
    console.error("ERROR al consultar ventas:", error.message);
    process.exit(1);
  }

  if (!ventas || ventas.length === 0) {
    console.log("No se encontraron ventas con receta en ese mes.");
    return;
  }

  const ventasFiltradas = limite ? ventas.slice(0, limite) : ventas;

  console.log(
    `Encontradas ${ventas.length} ventas con receta.` +
    (limite ? ` Descargando ${ventasFiltradas.length} (prueba con --limite ${limite}).` : "")
  );

  const desktopDir = path.join(os.homedir(), "Desktop", `BrosPharma-${mesArg}`);
  fs.mkdirSync(desktopDir, { recursive: true });

  let totalRecetas = 0;
  let totalFacturas = 0;

  for (const venta of ventasFiltradas) {
    const carpetaNombre = `venta-${venta.id}-${sanitize(venta.cliente_nombre)}`;
    const carpeta = path.join(desktopDir, carpetaNombre);
    fs.mkdirSync(carpeta, { recursive: true });

    let ventaRecetas = 0;
    let ventaFacturas = 0;

    // Recetas
    const { data: recetas, error: errRecetas } = await supabase
      .from("ventas_recetas")
      .select("path")
      .eq("venta_id", venta.id);

    if (errRecetas) {
      console.warn(`  ⚠️  Error al obtener recetas de venta ${venta.id}: ${errRecetas.message}`);
    } else {
      for (let i = 0; i < (recetas || []).length; i++) {
        const storagePath = recetas[i].path;
        const ext = path.extname(path.basename(storagePath)).replace(".", "") || "jpg";
        const fileName = recetas.length > 1 ? `receta-${i + 1}.${ext}` : `receta.${ext}`;
        const ok = await downloadFile(supabase, storagePath, path.join(carpeta, fileName));
        if (ok) { ventaRecetas++; totalRecetas++; }
      }
    }

    // Facturas IVA
    const { data: facturas, error: errFacturas } = await supabase
      .from("ventas_facturas")
      .select("path, numero_factura")
      .eq("venta_id", venta.id)
      .eq("tipo", "IVA");

    if (errFacturas) {
      console.warn(`  ⚠️  Error al obtener facturas de venta ${venta.id}: ${errFacturas.message}`);
    } else {
      for (const factura of facturas || []) {
        const fileName = factura.numero_factura
          ? `factura-IVA-${factura.numero_factura}.pdf`
          : "factura-IVA.pdf";
        const ok = await downloadFile(supabase, factura.path, path.join(carpeta, fileName));
        if (ok) { ventaFacturas++; totalFacturas++; }
      }
    }

    const icons = [
      ventaRecetas > 0 ? `📋 ${ventaRecetas} receta(s)` : "❌ sin receta",
      ventaFacturas > 0 ? `🧾 ${ventaFacturas} factura(s)` : "⏳ sin factura IVA",
    ].join("  ");
    console.log(`  ✓ venta-${venta.id}  ${venta.cliente_nombre || ""}  →  ${icons}`);
  }

  console.log(`\n✅ Listo. Guardado en: ${desktopDir}`);
  console.log(`   ${totalRecetas} receta(s) y ${totalFacturas} factura(s) IVA descargadas.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err.message || err);
  process.exit(1);
});
