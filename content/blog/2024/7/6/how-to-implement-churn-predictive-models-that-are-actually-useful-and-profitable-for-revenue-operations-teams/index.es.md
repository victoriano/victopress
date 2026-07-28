---
title: Cómo implementar modelos predictivos de abandono que sean realmente
  útiles y rentables para los equipos de Operaciones de Ingresos.
slug: 2024/7/6/how-to-implement-churn-predictive-models-that-are-actually-useful-and-profitable-for-revenue-operations-teams
date: 2024-07-06
description: "[Ilustración del abandono ideal con anotaciones en Hubspot ]
  [Ejemplos de empresas de Fletch (B2B, B2C) con 3 columnas ] [Diagrama resumen
  con los tipos de abandono con cajas jerárquicas para diapositivas ] Empieza
  por la atribución del abandono La mayoría de los modelos predictivos de
  abandono que he visto..."
author: Victoriano Izquierdo
locale: es
draft: false
format: markdown
tags:
  - Data Analytics
sourceUrl: https://app.notion.com/p/68fc4fc1e5994c42a9d6fdd1a9c65cfd
cover: blog/2024/7/6/how-to-implement-churn-predictive-models-that-are-actually-useful-and-profitable-for-revenue-operations-teams/image-01.png
coverInBody: true
---

\[Ilustración del abandono ideal con anotaciones en Hubspot\]

\[Ejemplos de empresas de Fletch (B2B, B2C) con 3 columnas\]

\[Diagrama resumen con los tipos de abandono con cajas jerárquicas para diapositivas\]

## Empieza por la atribución del abandono

---

La mayoría de los modelos predictivos de abandono que he visto en producción (ya sean creados por un equipo de ciencia de datos usando Python, asignando pesos manualmente con fórmulas heurísticas en los CRM, o usando algunas herramientas especializadas) suelen producir un único número o puntuación, que normalmente representa **la probabilidad** de que un cliente abandone o no renueve su contrato/servicio.

Esto es mejor que no tener nada porque nos dice que nos centremos más en los clientes que podrían irse. Pero también causa mucha confusión y exceso de análisis para los gestores de cuentas y los equipos de éxito del cliente sobre **qué hacer** con esos clientes.

La mejor manera de prevenir el abandono es entender** por qué ocurre**, y la clave para ello es examinar **el tipo y nivel de interacción** que el cliente ha tenido con la empresa.

![](/api/images/blog/2024/7/6/how-to-implement-churn-predictive-models-that-are-actually-useful-and-profitable-for-revenue-operations-teams/image-01.png "text-width")

**En resumen**: El enfoque ideal para la predicción del abandono es probablemente combinar **una puntuación de probabilidad de abandono** con una clasificación sencilla del **tipo de abandono basada en los niveles de interacción** Incluye algunas **métricas** que puedan dar más pistas sobre el tipo específico de abandono, y vincúlalas a una serie de **acciones sugeridas** para prevenirlo o dejarlo ir. Si tu servicio/producto no está diseñado para un cierto tipo de cliente, a menudo es mejor no perder el tiempo con ellos. También es crucial crear un modelo que pueda **predecir el abandono con semanas o incluso meses de antelación**, dando tiempo suficiente para implementar medidas efectivas.

## Tipo de abandono basado en los niveles de interacción

---

### Clientes que nunca llegaron a interactuar realmente

Definir una métrica para identificar cuándo un usuario se vuelve leal es crucial. A menudo implica rastrear un cierto número de días de uso repetido o compras, tras los cuales la mayoría de los clientes desarrollan un hábito, lo que resulta en una retención estable.

- **Mal encaje del cliente** - Esta suele ser la razón principal del alto abandono de clientes en muchas empresas, especialmente en aquellas que gastan mucho en publicidad y experimentan tasas de abandono superiores a lo normal. Clientes que nunca interactuaron realmente porque el producto o servicio no satisface sus necesidades, carece de funciones clave o resuelve un problema que no es importante para ellos. Poder medir las variables firmográficas de los clientes (como el sector y el tamaño de la empresa) o las variables demográficas ayuda a un modelo a identificar estos factores. Considera ajustar tu marketing para atraer a menos clientes de este tipo.
- **Mal proceso de incorporación (Onboarding)** - Probablemente puedas aportar valor a estos clientes, son el perfil de cliente ideal (ICP) correcto, pero no logras enseñarles cómo usarlo o trabajar contigo. Mejora los tutoriales, la experiencia de usuario (UX), los correos electrónicos de impulso en los primeros días, los programas de formación, un mejor soporte y mejores gestores de cuentas.

### Disminución de la interacción

Estos clientes interactuaban mucho, pero gradualmente dejaron de hacerlo por diferentes motivos:

- **Encontraron una alternativa mejor con un competidor**
	- Consiguieron un precio mejor - Considera ofrecer un descuento
	- Encontraron una solución mejor - Revisa el producto con ellos, ofrece soporte adicional gratuito o véndeles servicios profesionales.
- El problema que resolvían con tu solución **ya no es una prioridad**, o puede que se hayan **olvidado de ti** - Déjalos ir o vuelve a formarlos.
- El promotor, **el contacto principal**, la persona que sabía cómo usar tu producto **dejó la empresa** - vuelve a formar al equipo.
- Tuvieron una **mala experiencia con tu servicio de atención al cliente** - Mejora la atención al cliente o asigna un nuevo gestor de cuentas. Esto es bastante común en empresas B2C que atienden a cientos de miles o millones de clientes. A menudo, el servicio de atención al cliente se gestiona a través de centros de llamadas con operadores poco cualificados, y con frecuencia surgen problemas logísticos complejos.

### Fin repentino de la interacción

A veces, los usuarios que interactúan abandonan de repente y dejan de pagar. Estas son algunas de las razones más comunes:

- **Facturación** - En algunos negocios, esto podría representar hasta el 5% del abandono total. Cancelación involuntaria debido a problemas con el método de pago. Esto es fácil de solucionar, por ejemplo, si detectas con antelación que una tarjeta ha caducado.
- **Cambio normativo en un mercado  - **Una nueva normativa prohíbe el uso de tu producto o de ciertas funciones por motivos de privacidad, seguridad y geopolíticos.
- **La empresa cierra** - No hay mucho que puedas hacer al respecto ¯\\*(ツ)*/¯

## ¿Qué tipo de datos se necesitan para predecir el abandono con precisión?

---

### **Datos de ventas transaccionales.**

Todo negocio guarda registros de todo lo que vende. Los metadatos en torno a la fecha y hora de cada transacción, el ID de usuario, los ID de productos de servicio, la categoría del producto y la cantidad gastada son cruciales para cualquier modelo, desde un simple análisis de cohortes y modelos RFM hasta modelos predictivos complejos.

- **Cuanto más frecuentes sean las transacciones** de venta a un cliente, más datos generarás para aprender un patrón y encontrar tendencias.
- Los negocios que dependen de **suscripciones** (como el software SaaS, los servicios de contenido o incluso la entrega de comida) generan señales fuertes. Por el contrario, los minoristas con baja lealtad del cliente (que solo hacen unas pocas compras ocasionales al año) son menos capaces de generar señales tan fuertes para predecir el abandono. En estos casos, es más interesante usar modelos que predigan el comportamiento de recompra en lugar del abandono.

### **Datos de uso/consumo. **

Casi cualquier negocio que se haya digitalizado puede ahora recopilar datos no solo sobre las transacciones de ventas, sino también sobre **cada acción que los clientes realizan con sus productos**. No solo qué productos compran, sino también cuáles miran y no compran. Cada clic, cada desplazamiento, cada función utilizada, y cuántas personas de su equipo usan el producto y de qué maneras. Hoy en día, esta es **la fuente de datos más rica para cualquier modelo de abandono**. Estos eventos se pueden recopilar fácilmente con herramientas como GA4, Segment, Jitsu, Snowplow y muchas otras.

- Cada producto tiene una **frecuencia de uso esperada** basada en su naturaleza. Por ejemplo, un software de RRHH donde se registran las horas trabajadas debería usarse a diario, mientras que una aplicación para aprender idiomas debería usarse unas cuantas veces a la semana. Algunos servicios, como los suministros y la electricidad, se usan de forma más **estacional**, aumentando durante los meses más fríos o más cálidos.
- Cada usuario sigue una ruta de eventos mientras usa un producto o servicio. Entender la **secuencia de estos eventos** y cualquier cambio puede ayudarnos a entender el abandono del usuario. Esto es especialmente útil para predecir el abandono causado por los correos electrónicos de incorporación o problemas con la experiencia de usuario del producto.

### **Datos firmográficos o demográficos**

- Si tus clientes son otras **empresas**, conocer detalles como el sector de la empresa, el número de empleados, el modelo de negocio y el rol de los usuarios puede ser extremadamente útil. Esta información te ayuda a predecir lo bien que encajará el cliente con tu producto o a ajustar el uso esperado para ese tipo de negocio. La mayoría de los CRM, como HubSpot o Salesforce, pueden proporcionarte directamente esta información infiriéndola de los dominios de correo electrónico de tus usuarios o usando API de terceros.
- Si estás en B2C, cualquier información **demográfica** sobre tus usuarios te ayudará a determinar si encajan en tu Perfil de Cliente Ideal (ICP). Dependiendo de tu producto, factores como la edad, la ciudad/estado, la profesión, las habilidades y otras variables pueden ser más o menos predictivos. Algunas de estas variables se pueden inferir de cosas como su nombre (género), dirección de envío o la dirección IP desde la que se conectan (ubicación geográfica). Otros detalles se pueden recopilar directamente de los formularios de registro.

### Cómo se adquirió el usuario

- La información sobre **cómo conoció el usuario el producto** es crucial para predecir el abandono, especialmente para aquellos que nunca llegan a interactuar.
- Por lo general, los clientes recomendados por otros clientes tienden a ser los más leales, seguidos por aquellos que encuentran el producto a través de SEO con intención de compra y **proactividad**, y por último, los que llegan a través de **campañas de marketing**. Esta variable ofrece información valiosa para mejorar ciertas campañas de adquisición sobre otras. Estos datos se suelen recopilar a través de parámetros UTM, pero las políticas de cookies y los bloqueadores de anuncios pueden dificultar la obtención de información de atribución de calidad.

### **Datos de satisfacción del cliente**:

- Una buena **atención al cliente** puede ser un factor clave en muchos sectores, ayudando a retener a los clientes que pueden no saber cómo usar el producto o encontrar problemas. Por otro lado, un mal soporte puede ahuyentarlos. La mayoría de las plataformas de soporte como Zendesk, Intercom, o los sistemas CRM como Salesforce y Hubspot, registran varios tipos de metadatos que pueden ayudar a identificar un posible abandono.
- Las típicas encuestas **NPS** (que miden la probabilidad de que un usuario recomiende el producto a otros) también se pueden incluir en este conjunto de variables que evalúan la calidad del servicio.

## Entonces, ¿qué tipo de empresas tienen más probabilidades de beneficiarse de un modelo predictivo de abandono?

---

### Empresas con muchos clientes y un gran mercado potencial

- **Cuantos más clientes** tengas, mejor podrá generalizar tu modelo predictivo.
- Cuantos más clientes tengas, mayor será el impacto en la predicción y prevención del abandono, lo que puede ayudar a salvar los ingresos perdidos y los recursos necesarios para atender a todos los clientes. Incluso mejoras moderadas en la tasa de abandono, del 10% al 20%, pueden tener un impacto multimillonario en los ingresos de las grandes empresas.
- Las empresas que venden a consumidores (B2C) a menudo tienen muchos clientes, aunque a veces hay poco o ningún negocio recurrente. Las empresas B2B que venden a un mercado empresarial muy especializado pueden tener solo unos pocos cientos de clientes. En tales casos, a menudo necesitan prestar tanta atención individual a cada cliente que un modelo predictivo puede no ser útil.
- **Las empresas B2B que venden a pymes** y al **mercado medio** con un alto valor de vida del cliente, o **las empresas B2C que ofrecen suscripciones a software o contenido**, son probablemente los mejores candidatos para lograr un alto ROI de los modelos de abandono.

### Diversidad de clientes

- Cuanto más diferentes sean los clientes entre sí, mayor será la probabilidad de que tengan comportamientos diferentes. El comportamiento del cliente a menudo varía mucho entre diferentes nacionalidades por diversas razones. Esto hace que sea más difícil desarrollar un sentido de lo que es normal, incluso si haces análisis más sofisticados como cohortes o RFM.
- Si vendes a sectores muy diferentes, tamaños de empresa o demografías diversas, un modelo de abandono podría ser muy útil.

### Diversidad de productos/servicios

- Casi todas las grandes empresas venden una amplia gama de productos y servicios utilizados por los mismos o diferentes clientes. Cuantos más productos tengan, más útil puede ser usar un modelo predictivo.
- Si tienes miles de SKU de productos, un modelo podría no ser capaz de generalizar de manera efectiva. Sin embargo, agruparlos por categorías puede ayudar. Además, si tu producto tiene múltiples funciones o ofreces muchos servicios, estos modelos pueden ayudar con la venta cruzada.

### La etapa de tu empresa

- Los modelos de abandono solo tienen sentido cuando una empresa ha **logrado el encaje producto-mercado**. Antes de eso, tendrás muy pocos usuarios que son demasiado diferentes entre sí, y demasiados problemas de producto para que un modelo identifique patrones claros.
- En **startups de Serie A y B, C, D…**, puede ser muy útil optimizar las campañas de marketing identificando qué Perfiles de Cliente Ideal (ICP) encajan mejor y averiguando qué tipos de campañas los atraen más. Además, estas empresas suelen ser nativas digitales, por lo que a menudo pueden capturar datos de interacción de alta calidad.
- En **empresas grandes y maduras** que tienen una amplia variedad de clientes y productos/servicios, estos enfoques pueden ser especialmente útiles por las razones mencionadas anteriormente. Además, los equipos de Operaciones de Ingresos pueden tener un impacto significativo al encontrar palancas de eficiencia en el negocio a través de estos modelos.
