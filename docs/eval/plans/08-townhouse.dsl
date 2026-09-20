plan "Townhouse" walls 0.3/0.12 stack piso0,piso1

level piso0 "Ground floor" h2.7 ground

room hall "Hall" hall rect 0,0 2.4x8
room sala "Living room" living rect 2.4,0 5x4
room cozinha "Kitchen" kitchen rect 2.4,4 5x4

door hall.north w1 entrance
door hall>sala w0.9 swing:sala
door hall>cozinha w0.9 swing:cozinha
window sala.east w1.8
window cozinha.east w1.6
window cozinha.south w1.2

level piso1 "First floor" h2.6

room patamar "Landing" hall rect 0,0 2.4x8
room q1 "Bedroom 1" bedroom rect 2.4,0 5x4
room q2 "Bedroom 2" bedroom rect 2.4,4 3x4
room banho "Bathroom" bath rect 5.4,4 2x4

door patamar>q1 w0.8 swing:q1
door patamar>q2 w0.8 swing:q2
door patamar>banho w0.7 swing:banho
window q1.east w1.6
window q2.south w1.4
window banho.east w0.6

stairs escada "Stair" up:180 risers:16
  at piso0 in:hall rect 0.2,3.5 1.1x4.2
  at piso1 in:patamar rect 0.2,3.5 1.1x1.2
