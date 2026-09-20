plan "Cottage with a porch" walls 0.3/0.12

room sala "Living room" living rect 0,0 5x5
room cozinha "Kitchen" kitchen rect 5,0 3.5x5
room quarto "Bedroom" bedroom rect 0,5 5x3.5
room banho "Bathroom" bath rect 5,5 3.5x3.5
outdoor alpendre "Porch" covered rect 0,8.5 8.5x2.2

door alpendre>sala w1 entrance glazed
door sala>cozinha w0.9 swing:cozinha
door sala>quarto w0.8 swing:quarto
door quarto>banho w0.7 swing:banho
window sala.west w1.8
window cozinha.east w1.4
window quarto.west w1.4
window banho.east w0.6
