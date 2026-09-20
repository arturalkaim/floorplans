plan "Semi-detached with a void" walls 0.3/0.12 stack r0,r1

grid cols 2.6,3.4,3 rows 4,2,2

level r0 "Ground" h3.2 ground

room hall "Hall" hall day
room sala "Living room" living day
room cozinha "Kitchen" kitchen day

layout
  hall sala sala
  hall sala sala
  hall cozinha cozinha

door hall.north w1 entrance
cased hall>sala w1.4
door hall>cozinha w0.9 swing:cozinha
window sala.east w2.2
window cozinha.south w1.6

level r1 "First floor" h2.6

room patamar "Landing" hall night
room q1 "Bedroom 1" bedroom night
room banho "Bathroom" bath night
void vazio_sala "Void over the living room"

layout
  patamar vazio_sala vazio_sala
  patamar vazio_sala vazio_sala
  patamar q1 banho

door patamar>q1 w0.8 swing:q1
door patamar>banho w0.7 swing:banho
window q1.south w1.4
window banho.south w0.6

stairs escada "Stair" up:180 risers:17
  at r0 in:hall rect 0.3,0.3 1.1x4.2
  at r1 in:patamar rect 0.3,0.3 1.1x1.2
