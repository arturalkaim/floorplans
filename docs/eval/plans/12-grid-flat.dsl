plan "Flat on a grid" walls 0.3/0.12

grid cols 4,2.5,3.5 rows 3.5,1.4,3.5

room sala "Living room" living
room cozinha "Kitchen" kitchen
room hall "Hall" hall
room quarto "Bedroom" bedroom
room banho "Bathroom" bath

layout
  sala sala cozinha
  hall hall hall
  quarto quarto banho

door hall.west w1 entrance
door hall>sala w0.9 swing:sala
door hall>cozinha w0.9 swing:cozinha
door hall>quarto w0.8 swing:quarto
door hall>banho w0.7 swing:banho
window sala.north w2
window cozinha.east w1.4
window quarto.south w1.6
window banho.south w0.6
