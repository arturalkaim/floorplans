plan "Loft conversion" walls 0.3/0.1 stack piso1,sotao

level piso1 "First floor" h2.6 ground

room patamar "Landing" hall rect 0,0 2.5x6
room quarto "Bedroom" bedroom rect 2.5,0 5x6

door patamar.west w0.9 entrance
door patamar>quarto w0.8 swing:quarto
window quarto.east w1.6

level sotao "Loft" h2.3

room estudio "Studio" office rect 0,0 5.5x6
room duche "Shower room" bath rect 5.5,0 2x6

door estudio>duche w0.7 swing:duche
window estudio.west w2
window duche.east w0.6

stairs escada up:90 risers:15
  at piso1 in:patamar rect 0.3,0.3 1.1x4.2
  at sotao in:estudio rect 0.3,0.3 1.1x1.1
