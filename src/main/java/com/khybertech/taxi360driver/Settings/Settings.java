package com.khybertech.taxi360driver.Settings;

import android.app.ProgressDialog;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.Log;
import android.widget.ListView;
import android.widget.SimpleAdapter;

import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;

import org.json.JSONArray;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

public class Settings extends AppCompatActivity {

    ListView lv_settings;
    SecurePreferences pref;
    List<String> ls_data_fromweb,ls_data_keys;
    List<HashMap<String,Object>> ls_data;
    List<Model> ls_data_custom;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);
        widgets();
//        pref = PreferenceManager.getDefaultSharedPreferences(Settings.this);
        pref = appcontext.getInstance().pref;
        ls_data_fromweb = new ArrayList<>();
        ls_data = new ArrayList<>();
        ls_data_keys = new ArrayList<>();
        ls_data_custom = new ArrayList<>();
        new login().execute();
    }

    private void widgets() {
        lv_settings = (ListView) findViewById(R.id.lv_settings);
    }

    public class login extends AsyncTask<Void,Void,String> {
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(Settings.this,"Cabs Wiki","Logging In!",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverSettings");
                String params = "DriverId="+appcontext.getInstance().DriverId;
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){
                Log.e("Taxi360taxi",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            try {
                JSONArray arr = new JSONArray(s);
                String ShowClientPhone = arr.getJSONObject(0).getString("ShowClientPhone");
                String ShowComingJobs = arr.getJSONObject(0).getString("ShowComingJobs");
                String AnonymizeVehicles = arr.getJSONObject(0).getString("AnonymizeVehicles");
                String DispatchNumber = arr.getJSONObject(0).getString("DispatchNumber");
                String I_Accept_Job_when_busy = arr.getJSONObject(0).getString("I_Accept_Job_when_busy");
                String I_Accept_Job_when_Away = arr.getJSONObject(0).getString("I_Accept_Job_when_Away");
                String I_Accept_Job_when_Clearing = arr.getJSONObject(0).getString("I_Accept_Job_when_Clearing");
                String Company_Setting_For_Jobs_When_New_Job_Came = arr.getJSONObject(0).getString("Company_Setting_For_Jobs_When_New_Job_Came");
                String DriverAddJobs = arr.getJSONObject(0).getString("DriverAddJobs");
                String DriverEditJobs = arr.getJSONObject(0).getString("DriverEditJobs");
                String HidePriceFromDriver = arr.getJSONObject(0).getString("HidePriceFromDriver");
                String PrefillEstimate = arr.getJSONObject(0).getString("PrefillEstimate");
                String RequirePrice = arr.getJSONObject(0).getString("RequirePrice");
                String HidePassenger = arr.getJSONObject(0).getString("HidePassenger");
                String HideExtraInfo = arr.getJSONObject(0).getString("HideExtraInfo");
                String HideDropOff = arr.getJSONObject(0).getString("HideDropOff");
                String HidePickUp = arr.getJSONObject(0).getString("HidePickUp");
                String JobAcceptTimeOut = arr.getJSONObject(0).getString("JobAcceptTimeOut");
                String MinimumPickUpWaitMin = arr.getJSONObject(0).getString("MinimumPickUpWaitMin");
                String MinimumPickUpWaitSec = arr.getJSONObject(0).getString("MinimumPickUpWaitSec");
                ls_data_fromweb.add(ShowClientPhone);
                ls_data_fromweb.add(ShowComingJobs);
                ls_data_fromweb.add(AnonymizeVehicles);
                ls_data_fromweb.add(DispatchNumber);
                ls_data_fromweb.add(I_Accept_Job_when_busy);
                ls_data_fromweb.add(I_Accept_Job_when_Away);
                ls_data_fromweb.add(I_Accept_Job_when_Clearing);
                ls_data_fromweb.add(Company_Setting_For_Jobs_When_New_Job_Came);
                ls_data_fromweb.add(DriverAddJobs);
                ls_data_fromweb.add(DriverEditJobs);
                ls_data_fromweb.add(HidePriceFromDriver);
                ls_data_fromweb.add(PrefillEstimate);
                ls_data_fromweb.add(RequirePrice);
                ls_data_fromweb.add(HidePassenger);
                ls_data_fromweb.add(HideExtraInfo);
                ls_data_fromweb.add(HideDropOff);
                ls_data_fromweb.add(HidePickUp);
                ls_data_fromweb.add(JobAcceptTimeOut);
                ls_data_fromweb.add(MinimumPickUpWaitMin);
                ls_data_fromweb.add(MinimumPickUpWaitSec);

                ls_data_keys.add("Show Client Phone");
                ls_data_keys.add("Show Coming Jobs");
                ls_data_keys.add("Anonymize Vehicles");
                ls_data_keys.add("Dispatch Number");
                ls_data_keys.add("I Accept Job when busy");
                ls_data_keys.add("I Accept Job when Away");
                ls_data_keys.add("I Accept Job when Clearing");
                ls_data_keys.add("Company Setting For Jobs When New Job Came");
                ls_data_keys.add("Driver Add Jobs");
                ls_data_keys.add("Driver Edit Jobs");
                ls_data_keys.add("Hide Price From Driver");
                ls_data_keys.add("Prefill Estimate");
                ls_data_keys.add("Require Price");
                ls_data_keys.add("Hide Passenger");
                ls_data_keys.add("Hide Extra Info");
                ls_data_keys.add("Hide Drop Off");
                ls_data_keys.add("Hide Pick Up");
                ls_data_keys.add("Job Accept TimeOut");
                ls_data_keys.add("Minimum PickUp Wait Min");
                ls_data_keys.add("Minimum PickUp Wait Sec");

                for (int i = 0; i < ls_data_fromweb.size(); i++){
                    HashMap<String,Object> hm = new HashMap<>();
                    hm.put("title",ls_data_keys.get(i));
                    hm.put("data",ls_data_fromweb.get(i));
                    Model m = new Model();
                    m.setTitle(ls_data_keys.get(i));
                    m.setValue(ls_data_fromweb.get(i));
                    ls_data.add(hm);
                    ls_data_custom.add(m);
                }
                String[] from = {"title","data"};
                int[] to = {R.id.txt_key_list_details,R.id.txt_value_list_details};
                CustomAdapterSettings adapterSettings = new CustomAdapterSettings(Settings.this,ls_data_custom);
                SimpleAdapter adapter = new SimpleAdapter(Settings.this,ls_data,R.layout.row_list_details,from,to);
                lv_settings.setAdapter(adapterSettings);
            }
            catch (Exception ex){
                Log.e("error",ex.getMessage());
            }
        }
    }
}
