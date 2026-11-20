# klip

El proyecto está organizado en dos carpetas:

- [`front/`](front/): código que se ejecuta en el navegador. `front/public/` contiene imágenes e iconos estáticos; `front/fonts/` contiene fuentes.
- [`backend/`](backend/): esquema SQL de Supabase.

Para ejecutar la app localmente, sirve la carpeta `front` con Live Server o `npx serve front`. No abras `index.html` directamente, porque el service worker requiere HTTP/HTTPS.

Si ya tienes las tablas creadas, conserva sus datos. Ejecuta una vez [`001_security_hardening.sql`](backend/migrations/001_security_hardening.sql) en SQL Editor para restringir permisos y exigir que listas y tareas pertenezcan al mismo usuario que sus padres. [`schema.sql`](backend/schema.sql) es la referencia para un proyecto Supabase nuevo.

Los archivos JavaScript de `front/` pertenecen al frontend: manipulan la interfaz y llaman a la API de Supabase. Supabase aloja la autenticación y la base de datos, así que este repositorio no tiene un servidor propio con rutas HTTP, controladores o entidades ORM. Si más adelante se incorpora un backend propio (por ejemplo, Node/Express), ahí sí tendría sentido organizar rutas, controladores y entidades en `backend/`.

El navegador guarda los tokens de sesión en `sessionStorage`, que se elimina al cerrar la pestaña/app; por eso puede pedir iniciar sesión de nuevo al abrirla. `sessionStorage` reduce cuánto tiempo persiste el token, pero JavaScript aún puede leerlo: no equivale a una cookie `HttpOnly`. Los datos locales se guardan en una IndexedDB distinta por usuario. Las bases locales antiguas no se importan automáticamente para evitar mezclar cuentas; los datos sincronizados se recuperan desde Supabase. RLS, permisos mínimos, claves foráneas compuestas y CSP reducen el acceso entre cuentas y el riesgo de XSS. La clave `sb_publishable_...` del frontend es pública por diseño; no pongas nunca una clave `sb_secret_...` o `service_role` en `front/`. Para aislar tokens del JavaScript con cookies `HttpOnly` se necesita una arquitectura con backend/BFF; el frontend estático actual no puede hacerlo.

En la app, asigna fecha y hora al editar una tarea para verla en **Calendario**. **Exportar calendario (.ics)** crea un archivo compatible con Google Calendar con todas las tareas fechadas de la cuenta actual.

## Publicar en GitHub Pages

El workflow [deploy-pages.yml](.github/workflows/deploy-pages.yml) publica únicamente `front/` cada vez que se actualiza `main`.

1. En GitHub, abre **Settings → Pages** del repositorio y configura **Source: GitHub Actions**.
2. En Supabase, abre **Authentication → URL Configuration** y establece como **Site URL** la URL de Pages que muestra el repositorio. Añádela también a **Redirect URLs** (puedes usar `https://pablo-saave.github.io/AplicacionNotas/**`).
3. Desde la terminal, ejecuta `git add -A`, `git commit -m "Publicar klip PWA"` y `git push origin main`.
4. En GitHub, abre **Actions** y espera que **Deploy klip PWA to GitHub Pages** termine correctamente. La URL queda en **Settings → Pages** y en el resultado del workflow.

Si aún no aplicaste [`001_security_hardening.sql`](backend/migrations/001_security_hardening.sql), ejecútalo una sola vez en Supabase antes de usar la publicación. No ejecutes `schema.sql` sobre las tablas existentes.
