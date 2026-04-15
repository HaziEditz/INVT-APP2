package com.khybertech.taxi360driver;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.support.v7.widget.Toolbar;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.MainActivity;


public class MyAccountActivity extends AppCompatActivity {
    Toolbar toolbar_MyAccount;
    LinearLayout linearLayout_updateProfile;
    String passenger_email,passenger_password;
    String signIn_URL="";//R.string.SignIn+"";
    SecurePreferences sharedPreferences;
    SecurePreferences editor;
    TextView txt_user_email,txt_user_sign_out;
    AlertDialog dialogForSignOut;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_myaccount);
        signIn_URL="";//this.getString(R.string.SignIn);
        widgets();
        toolbarMethod();
//        sharedPreferences = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
        sharedPreferences = appcontext.getInstance().pref;
        editor = sharedPreferences;
        //retrieving user email from shared preferences
        passenger_email=sharedPreferences.getString("usernamedriver");
        passenger_password=sharedPreferences.getString("passworddriver");

        txt_user_email.setText(sharedPreferences.getString("usernamedriver"));
        //to open UpdateProfile Activity by clicking user email's layout
        linearLayout_updateProfile.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent toOpenUpdateProfile = new Intent(MyAccountActivity.this, UpdateProfileActivity.class);
                startActivity(toOpenUpdateProfile);
                MyAccountActivity.this.finish();
            }
        });
        txt_user_sign_out.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                AlertDialog.Builder alert_dialog_builder = new AlertDialog.Builder(MyAccountActivity.this, AlertDialog.THEME_DEVICE_DEFAULT_DARK);
                alert_dialog_builder.setCancelable(false)
                        .setTitle("Sign Out")
                        .setMessage("Are you sure you want to sign out ?")
                        .setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                editor.put("sign_in_status", "0");
//                                editor.commit();
                                Intent i=new Intent(MyAccountActivity.this,MainActivity.class);
                                startActivity(i);
                                MyAccountActivity.this.finish();
                            }
                        })
                        .setNegativeButton("No", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {

                            }
                        });
                dialogForSignOut = alert_dialog_builder.create();
                dialogForSignOut.show();
            }
        });
    }

    public void widgets(){
        toolbar_MyAccount= (Toolbar) findViewById(R.id.toolbar_MyAccountActivity);
        linearLayout_updateProfile= (LinearLayout) findViewById(R.id.linearLayout_updateProfile_MyAccountActivity);
        txt_user_email= (TextView) findViewById(R.id.user_email_MyAccountActivity);
        txt_user_sign_out= (TextView) findViewById(R.id.txt_sign_out_MyAcccoutActivity);
    }
    public void toolbarMethod(){
        setSupportActionBar(toolbar_MyAccount);
        getSupportActionBar().setTitle("Account Settings");
        toolbar_MyAccount.setNavigationIcon(R.mipmap.nav_back1);
        toolbar_MyAccount.setNavigationOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                onBackPressed();
            }
        });
    }

    @Override
    public void onBackPressed() {
       // Intent i=new Intent(MyAccountActivity.this,MapsActivity.class);
       // startActivity(i);
        MyAccountActivity.this.finish();
    }
}
