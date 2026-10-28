
type MemberBalance = {
    user_id: number;
    username: string;
    net_balance_paise: number;
};

type SettlementSuggestion = {
    from_user_id: number;
    from_username: string;
    to_user_id: number;
    to_username: string;
    amount_paise: number;
};

export function calculateSettlements(balances: MemberBalance[]): SettlementSuggestion[] {
    //validation to check if balances is empty
    if (balances.length === 0) {
        return [];
    }
    //valddation to check if the user's net balance has grown so large or negative
    const hasInvalidBalance = balances.some(
        (balance) => !Number.isSafeInteger(balance.net_balance_paise)
    );

    if (hasInvalidBalance) {
        throw new Error("Every net balance must be a safe integer");
    }


     //Input userId and username  validation 
    const hasInvalidMember = balances.some(
        (balance) =>
            !Number.isSafeInteger(balance.user_id) ||
            balance.user_id <= 0 ||
            typeof balance.username !== "string" ||
            balance.username.trim().length === 0
    );

    if (hasInvalidMember) {
        throw new Error(
            "Every member must have a positive safe user ID and a non-empty username"
        );
    }

    //Added the duplicate userId validation 
    const uniqueUserIds = new Set(
        balances.map((balance) => balance.user_id)
    );

    if (uniqueUserIds.size !== balances.length) {
        throw new Error("Duplicate user IDs are not allowed");
    }

   

    //Validation to check the total net_balance is zero or not
     const totalNetBalance = balances.reduce(
        (sum, balance) => sum + balance.net_balance_paise,
        0
     );

     if(totalNetBalance !== 0){
        throw new Error(
            "Total net balance must equal zero"
    );
}

    
    const debtors = balances.filter((balance) => {
      return balance.net_balance_paise < 0 ;
    });

    const creditors = balances.filter((balance) => {
       return balance.net_balance_paise > 0;
    });

    const settlements: SettlementSuggestion[] = [];

    const remainingDebtors = debtors.map((debtor) => ({
        ...debtor, 
        remaining_amount_paise: Math.abs(debtor.net_balance_paise),
    }));

    const remainingCreditors = creditors.map((creditor) => ({
        ...creditor, 
        remaining_amount_paise: Math.abs(creditor.net_balance_paise), 
    }));


    let debtorIndex = 0;
    let creditorIndex = 0;

    while(
        debtorIndex < remainingDebtors.length &&
        creditorIndex < remainingCreditors.length
    ) {
         const debtor = remainingDebtors[debtorIndex];
         const creditor = remainingCreditors[creditorIndex];

         if(!debtor || !creditor){
            break;
         }

        const paymentAmound = Math.min(
           debtor.remaining_amount_paise,
           creditor.remaining_amount_paise
        );


        settlements.push({
            from_user_id: debtor.user_id,
             from_username: debtor.username,
             to_user_id: creditor.user_id,
             to_username: creditor.username,
             amount_paise: paymentAmound,
        });

     debtor.remaining_amount_paise -= paymentAmound;
     creditor.remaining_amount_paise -= paymentAmound;

     if(debtor.remaining_amount_paise === 0){
        debtorIndex++;
     }

     if(creditor.remaining_amount_paise === 0){
        creditorIndex++;
     }
}


    return settlements;
}
