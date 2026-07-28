---
title: Primero, ingeniería de datos
slug: 2023/10/9/do-data-engineering-first
date: 2023-10-09
description: La mayoría de los directivos siguen las tendencias sin entender
  realmente la tecnología que hay detrás de la IA y los LLM; solo un pequeño
  porcentaje de empresas puede beneficiarse de personalizar sus propios modelos.
author: Victoriano Izquierdo
locale: es
draft: true
format: markdown
tags:
  - Data Analytics
  - Generative AI
  - Data Engineering
sourceUrl: https://app.notion.com/p/7241b455750246689d28b5df71935ede
cover: blog/2023/10/9/do-data-engineering-first/data-maturity-ladder.jpg
coverInBody: true
---

La mayoría de los directivos siguen las tendencias sin entender realmente la tecnología que hay detrás de la IA y los LLM, solo un pequeño porcentaje de empresas puede beneficiarse realmente de entrenar y personalizar sus propios modelos.

Como ocurrió hace años con IBM Watson, muchos invertirán recursos en algo que quedará obsoleto en lugar de invertir en los fundamentos para extraer inteligencia de negocio de los datos que producen.

Esto pasa por toda la escala de entender qué problemas de negocio tiene sentido resolver realmente, medir con precisión, tener una buena infraestructura de datos, cuadros de mando descriptivos bien definidos y analítica avanzada para entender el 'porqué', prototipar modelos y hacer previsiones

![](/api/images/blog/2023/10/9/do-data-engineering-first/data-maturity-ladder.jpg "text-width")

![](/api/images/blog/2023/10/9/do-data-engineering-first/data-analysis-process.png "text-width")

[Publicación relacionada en X](https://twitter.com/SeattleDataGuy/status/1723090286576898476/photo/1)

**Los datos**, por naturaleza, **siempre son subjetivos** y sin **interpretación humana**, **no tienen sentido**.

Incluso con todos los increíbles avances de la IA y los grandes modelos de lenguaje (LLM), creo que hay cuatro retos importantes que la IA no puede abordar sin un humano que aporte contexto. Aquí van mis apuestas, del más fácil al más difícil de resolver:

1 - **Variables externas medibles** - una campaña de la competencia, el tiempo, la celebración de un partido de fútbol, una pandemia, normalizar los datos por la población de un país... Todas estas variables, que a menudo no se incluyen en tus conjuntos de datos internos, suelen ser cruciales para explicar por qué ha ocurrido algo. De los retos que mencionaré, este es el más "sencillo", y la IA, especialmente ayudando a encontrar datos alternativos de empresas como Cybersync, servirá de ayuda. Sin embargo, el abanico de variables de datos externos es tan amplio que probablemente sigamos necesitando humanos para decidir qué datos buscar en cada contexto, con experiencia en la materia.

2 - **Variables internas difíciles/imposibles de medir.** Las variables más importantes y predictivas suelen ser extremadamente caras, difíciles o directamente imposibles de medir. Incluso medir los factores sociodemográficos o firmográficos de los clientes suele ser un reto. Pedir la edad en un formulario crea fricción, y pedir el género levanta sospechas sobre cómo se usarán esos datos. La psicografía es aún más difícil de medir. Podría inferirse a partir de un flujo de clics de eventos de comportamiento al usar un producto digital. Pero a menudo, estas variables solo pueden medirse a través de entrevistas entre humanos, **extrayendo información a través del arte de vender** y la complicidad humana - lo que comúnmente se conoce como **datos** **cualitativos**. Estas conversaciones suelen inspirar nuevas variables en las que nadie había pensado.

3 - **Los humanos pueden identificar y adaptarse a tendencias emergentes que los modelos de datos preexistentes no reconocen.** Aprender de los datos pasados es posible, pero los humanos adaptan continuamente su comportamiento. Por ejemplo, puedes ofrecer descuentos a los clientes que compraron ciertos productos para incentivarles a comprar otros. Sin embargo, tus clientes aprenderán, y el cupón podría acabar canibalizando futuras compras de otros productos sin que te des cuenta.

4 - **Entender el proceso de análisis de datos es fundamental para generar la confianza necesaria para la toma de decisiones.** Cualquier análisis implica numerosas decisiones y suposiciones sobre los datos. Esto incluye cómo se muestrean los datos, cómo se filtran, qué variables se ignoran, cuáles se tienen en cuenta y cómo se visualizan. Pequeños cambios pueden llevar a conclusiones totalmente opuestas. Esta incertidumbre hace que prácticamente nadie, por mucho que crea en los datos, pueda estar totalmente seguro de las conclusiones extraídas.

Sin herramientas que permitan entender de forma intuitiva y sencilla por qué se tomaron decisiones de análisis concretas, es muy probable que los responsables de la toma de decisiones no adquieran la confianza y convicción suficientes para actuar con audacia y decisión. Estas interfaces deben guiar e infundir confianza en el proceso de análisis, que es lo que pretendemos conseguir con Graphext.
